import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateGoogleFlowWorkflowImage, isGoogleFlowImageWorkflowModel } from './googleFlowImageWorkflow.js';
import { getPromptOptimizerProvider } from './promptOptimizerProviders.js';
import { resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import {
  buildOverlayAnalysisInstruction,
  buildProductAnalysisInstruction,
  buildProductScenePrompt,
  buildPlacementAnalysisInstruction,
  buildPoseAnalysisInstruction,
  buildSceneAnalysisInstruction,
  inferProductSceneAspectRatio,
  validateProductDimensions,
} from '../../shared/productSceneReplacement.js';
import { isMassageEquipmentName } from '../../shared/massageEquipmentCategories.js';

const activeJobs = new Set();

const atomicWriteJson = (filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
};

const getJobStorage = (workflowId, dirs) => {
  const imageTarget = resolveProjectMediaTarget(workflowId, 'images', dirs);
  const jobsDir = path.join(path.dirname(imageTarget.targetDir), '.jobs', 'product-scene');
  fs.mkdirSync(jobsDir, { recursive: true });
  return { imageTarget, jobsDir };
};

const jobFilePath = (jobId, workflowId, dirs) => path.join(getJobStorage(workflowId, dirs).jobsDir, `${jobId}.json`);

const readJob = (jobId, workflowId, dirs) => {
  const filePath = jobFilePath(jobId, workflowId, dirs);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const writeJob = (job, dirs) => {
  job.updatedAt = new Date().toISOString();
  atomicWriteJson(jobFilePath(job.id, job.workflowId, dirs), job);
  return job;
};

const parseStructuredAnalysis = text => {
  const source = String(text || '').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || source;
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('Codex 识图结果不是有效 JSON');
  const parsed = JSON.parse(fenced.slice(firstBrace, lastBrace + 1));
  const sceneAnalysis = String(parsed.sceneSpec || '').trim();
  const productAnalysis = String(parsed.productSpec || '').trim();
  const poseAnalysis = String(parsed.poseSpec || '').trim();
  const placementAnalysis = String(parsed.placementSpec || '').trim();
  // 场景本来就干净时没有叠加层，overlaySpec 允许为空；统一落成「无」，
  // 这样既能和「还没识别过」区分开，也不会让干净图直接报错。
  const overlayAnalysis = String(parsed.overlaySpec || '').trim() || '无';
  if (!sceneAnalysis || !poseAnalysis || !placementAnalysis || !productAnalysis) {
    throw new Error('Codex 识图结果缺少 sceneSpec、poseSpec、placementSpec 或 productSpec');
  }
  return { sceneAnalysis, poseAnalysis, placementAnalysis, productAnalysis, overlayAnalysis };
};

const buildCombinedRecognitionInstruction = job => [
  '你是商业产品场景替换分析器。本次附带两张图片，顺序固定：图片1是竞品场景图，图片2是我方产品标准图，禁止交换职责。',
  '请一次完成两张图的结构化分析，只输出一个合法 JSON 对象，不要 Markdown、解释或额外文字。',
  'JSON 格式必须为：{"sceneSpec":"...","poseSpec":"...","placementSpec":"...","overlaySpec":"...","productSpec":"..."}',
  `sceneSpec 规则：${buildSceneAnalysisInstruction()}`,
  `poseSpec 规则：${buildPoseAnalysisInstruction()}`,
  `placementSpec 规则：${buildPlacementAnalysisInstruction()}`,
  `overlaySpec 规则：${buildOverlayAnalysisInstruction()}`,
  `productSpec 规则：${buildProductAnalysisInstruction({
    preserveProductMarkings: job.preserveProductMarkings,
    productCategory: job.productCategory,
  })}`,
].join('\n\n');

const completeFromExistingMetadata = (job, dirs) => {
  const { imageTarget } = getJobStorage(job.workflowId, dirs);
  const metaPath = path.join(imageTarget.targetDir, `${job.resultNodeId}.json`);
  if (!fs.existsSync(metaPath)) return false;
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  job.status = 'completed';
  job.stage = 'completed';
  job.resultUrl = `${imageTarget.urlPrefix}/${metadata.filename}`;
  job.completedAt = metadata.createdAt || new Date().toISOString();
  writeJob(job, dirs);
  return true;
};

async function executeJob(job, context) {
  const { dirs, libraryDir, recognitionModel = 'gpt-5.6-sol' } = context;
  if (activeJobs.has(job.id)) return;
  activeJobs.add(job.id);
  try {
    if (completeFromExistingMetadata(job, dirs)) return;

    job.status = 'processing';
    if (!job.sceneAnalysis || !job.poseAnalysis || !job.placementAnalysis || !job.overlayAnalysis || !job.productAnalysis) {
      job.stage = 'analyzing';
      job.stageLabel = 'Codex 正在识别两张图片';
      writeJob(job, dirs);

      const sceneDataUrl = resolveImageToBase64(job.sceneImage);
      const productDataUrl = resolveImageToBase64(job.productImage);
      if (!sceneDataUrl || !productDataUrl) throw new Error('无法读取场景参考图或我方产品图');

      const provider = getPromptOptimizerProvider('codex-cli');
      const recognitionRequest = {
          systemInstruction: buildCombinedRecognitionInstruction(job),
          userPrompt: '严格按图片顺序识别，并返回指定 JSON。',
          imageDataUrls: [sceneDataUrl, productDataUrl],
          model: recognitionModel,
          effort: provider.defaultEffort || 'medium',
          temperature: 0.1,
          maxTokens: 3500,
      };
      const text = context.runRecognition
        ? await context.runRecognition(recognitionRequest)
        : await provider.run(recognitionRequest);
      Object.assign(job, parseStructuredAnalysis(text));
      job.recognitionProvider = 'codex-cli';
      job.recognitionModel = recognitionModel;
      writeJob(job, dirs);
    }

    job.stage = 'generating';
    job.stageLabel = 'Google Flow 正在生成图片';
    job.prompt = buildProductScenePrompt({
      sceneAnalysis: job.sceneAnalysis,
      poseAnalysis: job.poseAnalysis,
      placementAnalysis: job.placementAnalysis,
      productAnalysis: job.productAnalysis,
      overlayAnalysis: job.overlayAnalysis,
      dimensions: job.dimensions,
      preserveProductMarkings: job.preserveProductMarkings,
      strictSceneComposition: job.strictSceneComposition,
      productCategory: job.productCategory,
    });
    writeJob(job, dirs);

    const generationRequest = {
      prompt: job.prompt,
      aspectRatio: job.aspectRatio,
      referenceImageInputs: [job.sceneImage, job.productImage],
      libraryDir,
      timeoutMinutes: 10,
      modelId: job.imageModel,
    };
    const result = context.generateImage
      ? await context.generateImage(generationRequest)
      : await generateGoogleFlowWorkflowImage(generationRequest);

    const { imageTarget } = getJobStorage(job.workflowId, dirs);
    const saved = saveBufferToFile(result.buffer, imageTarget.targetDir, 'img', result.extension);
    const metadata = {
      id: job.resultNodeId,
      filename: saved.filename,
      prompt: job.prompt,
      model: job.imageModel,
      aspectRatio: job.aspectRatio,
      createdAt: new Date().toISOString(),
      type: 'images',
      sourceJobId: job.id,
    };
    atomicWriteJson(path.join(imageTarget.targetDir, `${job.resultNodeId}.json`), metadata);

    job.status = 'completed';
    job.stage = 'completed';
    job.stageLabel = '生成完成';
    job.resultUrl = `${imageTarget.urlPrefix}/${saved.filename}`;
    job.completedAt = metadata.createdAt;
    job.error = undefined;
    writeJob(job, dirs);
  } catch (error) {
    job.status = 'failed';
    job.stage = 'failed';
    job.stageLabel = '任务失败';
    job.error = error instanceof Error ? error.message : String(error);
    job.failedAt = new Date().toISOString();
    writeJob(job, dirs);
  } finally {
    activeJobs.delete(job.id);
  }
}

export function createProductSceneJob(payload, context) {
  const dimensionError = validateProductDimensions(payload.dimensions);
  if (dimensionError) throw new Error(dimensionError);
  if (!payload.workflowId || !payload.nodeId || !payload.sceneImage || !payload.productImage) {
    throw new Error('缺少项目、节点或两张参考图片');
  }
  if (!isGoogleFlowImageWorkflowModel(payload.imageModel)) {
    throw new Error('产品场景替换当前仅支持 Google Flow 图片模型');
  }
  if (payload.productCategory && !isMassageEquipmentName(payload.productCategory)) {
    throw new Error('请选择有效的按摩器材产品类别');
  }

  const requestedJobId = String(payload.jobId || '').trim();
  if (requestedJobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedJobId)) {
    throw new Error('产品场景任务 ID 格式无效');
  }
  if (requestedJobId) {
    const existing = readJob(requestedJobId, payload.workflowId, context.dirs);
    if (existing) {
      if ((existing.status === 'pending' || existing.status === 'processing') && !activeJobs.has(existing.id)) {
        void executeJob(existing, context);
      }
      return existing;
    }
  }

  const previous = payload.retryJobId
    ? readJob(payload.retryJobId, payload.workflowId, context.dirs)
    : null;
  const now = new Date().toISOString();
  const job = {
    id: requestedJobId || crypto.randomUUID(),
    workflowId: payload.workflowId,
    nodeId: payload.nodeId,
    resultNodeId: crypto.randomUUID(),
    status: 'pending',
    stage: 'queued',
    stageLabel: '任务已创建',
    sceneImage: payload.sceneImage,
    productImage: payload.productImage,
    dimensions: payload.dimensions,
    productCategory: payload.productCategory || '',
    preserveProductMarkings: payload.preserveProductMarkings !== false,
    strictSceneComposition: payload.strictSceneComposition !== false,
    imageModel: payload.imageModel,
    aspectRatio: inferProductSceneAspectRatio(payload.aspectRatio, '1:1'),
    recognitionProvider: 'codex-cli',
    recognitionModel: context.recognitionModel || 'gpt-5.6-sol',
    ...(previous?.sceneAnalysis && previous?.poseAnalysis && previous?.placementAnalysis
      && previous?.overlayAnalysis && previous?.productAnalysis
      ? {
          sceneAnalysis: previous.sceneAnalysis,
          poseAnalysis: previous.poseAnalysis,
          placementAnalysis: previous.placementAnalysis,
          overlayAnalysis: previous.overlayAnalysis,
          productAnalysis: previous.productAnalysis,
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
  writeJob(job, context.dirs);
  void executeJob(job, context);
  return job;
}

export function getLatestProductSceneJob(nodeId, workflowId, context) {
  if (!nodeId || !workflowId) return null;
  const { jobsDir } = getJobStorage(workflowId, context.dirs);
  const latest = fs.readdirSync(jobsDir)
    .filter(name => name.endsWith('.json'))
    .map(name => {
      try {
        return JSON.parse(fs.readFileSync(path.join(jobsDir, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(job => job?.workflowId === workflowId && job?.nodeId === nodeId)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null;
  if (latest && (latest.status === 'pending' || latest.status === 'processing') && !activeJobs.has(latest.id)) {
    void executeJob(latest, context);
  }
  return latest;
}

export function getProductSceneJob(jobId, workflowId, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if ((job.status === 'pending' || job.status === 'processing') && !activeJobs.has(job.id)) {
    void executeJob(job, context);
  }
  return job;
}
