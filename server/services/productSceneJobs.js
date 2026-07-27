import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { generateGoogleFlowWorkflowImage, isGoogleFlowImageWorkflowModel } from './googleFlowImageWorkflow.js';
import { generateJimengWorkflowImage, isJimengImageWorkflowModel } from './jimengImageWorkflow.js';
import { generateGoogleFlowWorkflowVideo, isGoogleFlowWorkflowModelId } from './googleFlowWorkflow.js';
import { generateJimengWorkflowVideo, isJimengWorkflowModelId, resolveJimengModelLabel } from './jimengVideoWorkflow.js';
import { generateGeminiWebImage, generateGeminiWebVideo, isGeminiWebImageModel, isGeminiWebVideoModel } from './geminiWebWorkflow.js';
import { generateSeedanceVideo } from './seedance.js';
import { createCodexImageJob, getCodexImageJob } from './codexImageJobs.js';
import { getPromptOptimizerProvider } from './promptOptimizerProviders.js';
import { resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import {
  buildCompositionAnalysisInstruction,
  buildPersonaAnalysisInstruction,
  buildProductAnalysisInstruction,
  buildProductScenePrompt,
  buildSceneAnalysisInstruction,
  validateProductDimensions,
} from '../../shared/productSceneReplacement.js';
import { isMassageEquipmentName } from '../../shared/massageEquipmentCategories.js';

import {
  clampImageOutputCount,
  getImageGenerationProvider,
  getVideoGenerationProvider,
  normalizeImageAspectRatio,
  normalizeVideoParameters,
  resolveVideoModelForAspectRatio,
} from '../../shared/generationProviders.js';

// 产品短视频以竖版投放为主，默认 9:16。比例由用户在节点上统一指定，
// 替换图与短视频共用同一个值，不再从场景参考图推断。
export const DEFAULT_PRODUCT_SCENE_ASPECT_RATIO = '9:16';
export const DEFAULT_PRODUCT_SCENE_VIDEO_MODEL = 'gemini-web-video';

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
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('识图结果不是有效 JSON');
  const parsed = JSON.parse(fenced.slice(firstBrace, lastBrace + 1));
  const sceneAnalysis = String(parsed.sceneSpec || '').trim();
  const productAnalysis = String(parsed.productSpec || '').trim();
  const personaAnalysis = String(parsed.personaSpec || '').trim();
  const compositionAnalysis = String(parsed.compositionSpec || '').trim();
  if (!sceneAnalysis || !personaAnalysis || !compositionAnalysis || !productAnalysis) {
    throw new Error('识图结果缺少 sceneSpec、personaSpec、compositionSpec 或 productSpec');
  }
  return { sceneAnalysis, personaAnalysis, compositionAnalysis, productAnalysis };
};

const buildCombinedRecognitionInstruction = job => [
  '你是商业产品场景替换分析器。本次附带两张图片，顺序固定：图片1是竞品场景图，图片2是我方产品标准图，禁止交换职责。',
  '请一次完成两张图的结构化分析，只输出一个合法 JSON 对象，不要 Markdown、解释或额外文字。',
  'JSON 格式必须为：{"sceneSpec":"...","personaSpec":"...","compositionSpec":"...","productSpec":"..."}',
  `sceneSpec 规则：${buildSceneAnalysisInstruction()}`,
  `personaSpec 规则：${buildPersonaAnalysisInstruction()}`,
  `compositionSpec 规则：${buildCompositionAnalysisInstruction()}`,
  `productSpec 规则：${buildProductAnalysisInstruction({
    preserveProductMarkings: job.preserveProductMarkings,
    productCategory: job.productCategory,
  })}`,
].join('\n\n');

const completeFromExistingMetadata = (job, dirs) => {
  if (Array.isArray(job.resultUrls) && job.resultUrls.length > 0) return false;
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

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForCodexResult(context, codexJobId, timeoutMs = 30 * 60_000) {
  context.codexAutomation?.notify?.();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = getCodexImageJob(context.codexJobsDir, codexJobId);
    if (current?.status === 'completed' && current.resultUrl) return current.resultUrl;
    if (current?.status === 'failed') throw new Error(current.error || 'Codex 生图任务失败');
    await delay(1_500);
  }
  throw new Error('Codex 生图任务超时');
}

async function generateProductImages(job, context) {
  const provider = getImageGenerationProvider(job.imageModel);
  if (!provider) throw new Error(`未知图片模型：${job.imageModel}`);
  const count = clampImageOutputCount(job.imageModel, job.imageCount);
  const request = {
    prompt: job.prompt,
    aspectRatio: job.aspectRatio,
    resolution: job.imageResolution || 'Auto',
    referenceImageInputs: [job.productImage],
    libraryDir: context.libraryDir,
    timeoutMinutes: 10,
    modelId: job.imageModel,
    count,
  };
  if (isGoogleFlowImageWorkflowModel(job.imageModel)) return (await generateGoogleFlowWorkflowImage(request)).images;
  if (isJimengImageWorkflowModel(job.imageModel)) return (await generateJimengWorkflowImage(request)).images;
  if (isGeminiWebImageModel(job.imageModel)) return (await generateGeminiWebImage(request)).images;
  if (job.imageModel === 'codex-imagegen') {
    const target = resolveProjectMediaTarget(job.workflowId, 'images', context.dirs);
    const results = [];
    for (let index = 0; index < count; index += 1) {
      const codexJob = createCodexImageJob({
        jobsDir: context.codexJobsDir,
        libraryDir: context.libraryDir,
        nodeId: `${job.nodeId}-image-${index + 1}`,
        prompt: job.prompt,
        aspectRatio: job.aspectRatio,
        resolution: job.imageResolution || 'Auto',
        referenceImages: [job.productImage],
        workflowId: job.workflowId,
        projectDirName: target.projectDirName,
      });
      results.push({ resultUrl: await waitForCodexResult(context, codexJob.id) });
    }
    return results;
  }
  throw new Error(`产品短视频节点暂不支持图片模型：${job.imageModel}`);
}

async function generateProductVideo(job, imageUrl, index, context) {
  const model = getVideoGenerationProvider(job.videoModel);
  if (!model || !model.supportsImageToVideo) throw new Error('所选视频模型不支持图生视频');
  const parameters = normalizeVideoParameters(job.videoModel, { aspectRatio: job.videoAspectRatio, duration: job.videoDuration });
  if (isGeminiWebVideoModel(job.videoModel)) {
    return generateGeminiWebVideo({
      prompt: job.videoPrompt, referenceImageInputs: [imageUrl], libraryDir: context.libraryDir,
      aspectRatio: parameters.aspectRatio, duration: parameters.duration || 8, timeoutMinutes: 15,
      nativeAudio: job.videoGenerateAudio !== false,
    });
  }
  if (isGoogleFlowWorkflowModelId(job.videoModel)) {
    return generateGoogleFlowWorkflowVideo({
      prompt: job.videoPrompt, firstFrameInput: imageUrl, referenceImageInputs: [], libraryDir: context.libraryDir,
      aspectRatio: parameters.aspectRatio, duration: parameters.duration, modelId: job.videoModel, timeoutMinutes: 15,
    });
  }
  if (isJimengWorkflowModelId(job.videoModel)) {
    return generateJimengWorkflowVideo({
      prompt: job.videoPrompt, referenceImageInputs: [imageUrl], referenceLabels: [`产品替换图${index + 1}`],
      model: resolveJimengModelLabel(job.videoModel), aspectRatio: parameters.aspectRatio,
      duration: parameters.duration || 5, resolution: job.videoResolution || '720P',
      libraryDir: context.libraryDir, timeoutMinutes: 15,
    });
  }
  if (job.videoModel?.startsWith('seedance-')) {
    if (!context.arkApiKey) throw new Error('Seedance 需要在设置中配置火山方舟 ARK API Key');
    const remoteUrl = await generateSeedanceVideo({
      prompt: job.videoPrompt, imageBase64: resolveImageToBase64(imageUrl), modelId: job.videoModel,
      aspectRatio: parameters.aspectRatio, resolution: job.videoResolution || '720p',
      duration: parameters.duration || 5, generateAudio: job.videoGenerateAudio !== false,
      apiKey: context.arkApiKey,
    });
    const response = await fetch(remoteUrl);
    if (!response.ok) throw new Error(`Seedance 视频下载失败：HTTP ${response.status}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), extension: 'mp4', source: 'url' };
  }
  throw new Error(`产品短视频节点暂不支持视频模型：${job.videoModel}`);
}

async function executeJob(job, context) {
  const { dirs, libraryDir, recognitionModel = 'gpt-5.6-sol' } = context;
  if (activeJobs.has(job.id)) return;
  activeJobs.add(job.id);
  try {
    if (completeFromExistingMetadata(job, dirs)) return;

    job.status = 'processing';
    job.imageCount = clampImageOutputCount(job.imageModel, job.imageCount || 1);
    job.resultNodeIds = Array.isArray(job.resultNodeIds) && job.resultNodeIds.length
      ? job.resultNodeIds
      : [job.resultNodeId || crypto.randomUUID()];
    job.videoResultNodeIds = Array.isArray(job.videoResultNodeIds) && job.videoResultNodeIds.length
      ? job.videoResultNodeIds
      : Array.from({ length: job.imageCount }, () => crypto.randomUUID());
    if (!job.sceneAnalysis || !job.personaAnalysis || !job.compositionAnalysis || !job.productAnalysis) {
      job.stage = 'analyzing';
      job.stageLabel = job.recognitionProvider === 'gemini-web'
        ? 'Gemini Web 正在识别两张图片'
        : 'Codex 正在识别两张图片';
      writeJob(job, dirs);

      const sceneDataUrl = resolveImageToBase64(job.sceneImage);
      const productDataUrl = resolveImageToBase64(job.productImage);
      if (!sceneDataUrl || !productDataUrl) throw new Error('无法读取场景参考图或我方产品图');

      const provider = getPromptOptimizerProvider(job.recognitionProvider);
      if (!provider) throw new Error(`未知识图 Provider：${job.recognitionProvider}`);
      const recognitionRequest = {
          systemInstruction: buildCombinedRecognitionInstruction(job),
          userPrompt: '严格按图片顺序识别，并返回指定 JSON。',
          imageDataUrls: [sceneDataUrl, productDataUrl],
          model: recognitionModel,
          effort: provider.defaultEffort || 'medium',
          temperature: 0.1,
          maxTokens: 3500,
          libraryDir,
      };
      const text = context.runRecognition
        ? await context.runRecognition(recognitionRequest)
        : await provider.run(recognitionRequest);
      Object.assign(job, parseStructuredAnalysis(text));
      job.recognitionModel = job.recognitionProvider === 'gemini-web' ? 'Gemini Web' : recognitionModel;
      writeJob(job, dirs);
    }

    job.stage = 'generating_images';
    // 不写「0 / N」：浏览器图片模型是一次调用返回整批，计数只能在整批落地后才动，
    // 用户会盯着 0 / 4 看好几分钟，以为卡住了。
    job.stageLabel = `正在生成 ${job.imageCount} 张替换图`;
    job.prompt = buildProductScenePrompt({
      sceneAnalysis: job.sceneAnalysis,
      personaAnalysis: job.personaAnalysis,
      compositionAnalysis: job.compositionAnalysis,
      productAnalysis: job.productAnalysis,
      personaBrief: job.personaBrief,
      dimensions: job.dimensions,
      preserveProductMarkings: job.preserveProductMarkings,
      productCategory: job.productCategory,
    });
    writeJob(job, dirs);

    const { imageTarget } = getJobStorage(job.workflowId, dirs);
    const generatedImages = Array.isArray(job.resultUrls) && job.resultUrls.length
      ? job.resultUrls.map(resultUrl => ({ resultUrl }))
      : context.generateImages
      ? await context.generateImages(job)
        : context.generateImage
        ? [await context.generateImage({
            prompt: job.prompt, aspectRatio: job.aspectRatio,
            referenceImageInputs: [job.productImage], libraryDir,
            timeoutMinutes: 10, modelId: job.imageModel, count: 1,
          })]
        : await generateProductImages(job, context);
    if (!Array.isArray(generatedImages) || generatedImages.length === 0) {
      throw new Error('图片模型没有返回可保存的产品替换图');
    }
    const imageResults = [];
    for (let index = 0; index < Math.min(generatedImages.length, job.imageCount); index += 1) {
      const result = generatedImages[index];
      const nodeId = job.resultNodeIds[index] || crypto.randomUUID();
      job.resultNodeIds[index] = nodeId;
      let resultUrl = result.resultUrl;
      if (!resultUrl) {
        const saved = saveBufferToFile(result.buffer, imageTarget.targetDir, 'img', result.extension || 'png');
        resultUrl = `${imageTarget.urlPrefix}/${saved.filename}`;
        atomicWriteJson(path.join(imageTarget.targetDir, `${nodeId}.json`), {
          id: nodeId, filename: saved.filename, prompt: job.prompt, model: job.imageModel,
          aspectRatio: job.aspectRatio, createdAt: new Date().toISOString(), type: 'images',
          sourceJobId: job.id, batchIndex: index, batchCount: generatedImages.length,
        });
      }
      imageResults.push({ index, nodeId, resultUrl, status: 'success' });
      job.imageResults = imageResults;
      job.resultUrls = imageResults.map(item => item.resultUrl);
      job.resultUrl = job.resultUrls[0];
      job.resultNodeId = job.resultNodeIds[0];
      job.stageLabel = `已完成替换图 ${index + 1} / ${job.imageCount}`;
      writeJob(job, dirs);
    }

    job.stage = 'images_completed';
    job.stageLabel = `${imageResults.length} 张替换图已完成`;
    writeJob(job, dirs);

    if (!job.autoGenerateVideo) {
      job.status = 'completed';
      job.stage = 'completed';
      job.stageLabel = '图片生成完成';
      job.completedAt = new Date().toISOString();
      job.error = undefined;
      writeJob(job, dirs);
      return;
    }
    if (!job.videoPrompt) throw new Error('自动生成视频已开启，但没有连接短视频提示词文本节点');

    const { targetDir: videoDir, urlPrefix: videoPrefix } = resolveProjectMediaTarget(job.workflowId, 'videos', dirs);
    job.stage = 'generating_videos';
    job.videoTasks = Array.isArray(job.videoTasks) && job.videoTasks.length
      ? job.videoTasks.map(task => task.status === 'running'
          ? { ...task, status: 'failed', error: '应用在提交后中断，请先检查平台历史记录；系统不会自动重复提交' }
          : task)
      : imageResults.map((image, index) => ({
          index, imageNodeId: image.nodeId, videoNodeId: job.videoResultNodeIds[index], status: 'waiting',
        }));
    writeJob(job, dirs);
    for (let index = 0; index < imageResults.length; index += 1) {
      const latest = readJob(job.id, job.workflowId, dirs);
      if (latest?.cancelRequested) {
        job.cancelRequested = true;
        break;
      }
      const task = job.videoTasks[index];
      if (task.status === 'success' || task.status === 'failed') continue;
      task.status = 'running';
      job.currentVideoIndex = index + 1;
      job.stageLabel = `正在生成视频 ${index + 1} / ${imageResults.length}`;
      writeJob(job, dirs);
      try {
        const video = context.generateVideo
          ? await context.generateVideo({ job, image: imageResults[index], index })
          : await generateProductVideo(job, imageResults[index].resultUrl, index, context);
        const saved = saveBufferToFile(video.buffer, videoDir, 'vid', video.extension || 'mp4');
        task.status = 'success';
        task.resultUrl = `${videoPrefix}/${saved.filename}`;
        atomicWriteJson(path.join(videoDir, `${task.videoNodeId}.json`), {
          id: task.videoNodeId, filename: saved.filename, prompt: job.videoPrompt, model: job.videoModel,
          aspectRatio: job.videoAspectRatio, duration: job.videoDuration, createdAt: new Date().toISOString(),
          type: 'videos', sourceJobId: job.id, sourceImageNodeId: task.imageNodeId,
        });
      } catch (videoError) {
        task.status = 'failed';
        task.error = videoError instanceof Error ? videoError.message : String(videoError);
        task.errorCode = videoError?.code;
        task.retryBlocked = videoError?.submitted === true;
      }
      // 取消请求可能在当前视频执行期间由另一个请求写入磁盘；写回任务结果前合并，
      // 不能让内存中的旧 job 覆盖掉 cancelRequested。
      if (readJob(job.id, job.workflowId, dirs)?.cancelRequested) {
        job.cancelRequested = true;
      }
      writeJob(job, dirs);
    }

    const failedCount = job.videoTasks.filter(task => task.status === 'failed').length;
    const retryBlockedCount = job.videoTasks.filter(task => task.status === 'failed' && task.retryBlocked).length;
    const successCount = job.videoTasks.filter(task => task.status === 'success').length;
    job.status = failedCount || job.cancelRequested ? 'partial_failed' : 'completed';
    job.stage = failedCount || job.cancelRequested ? 'partial_failed' : 'completed';
    job.stageLabel = job.cancelRequested
      ? `已取消，保留 ${successCount} 条已完成视频`
      : failedCount ? `完成 ${successCount} / ${job.videoTasks.length} 条视频` : '图片与视频全部完成';
    job.completedAt = new Date().toISOString();
    job.error = job.cancelRequested
      ? `视频队列已取消，已保留 ${successCount} 条成功结果`
      : retryBlockedCount
        ? `${retryBlockedCount} 条视频提交状态未知，请先检查平台历史记录；系统不会重复提交`
        : failedCount ? `${failedCount} 条视频生成失败，已保留成功结果` : undefined;
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
  const imageProvider = getImageGenerationProvider(payload.imageModel);
  if (!imageProvider) throw new Error('请选择有效的图片生成模型');
  const imageCount = clampImageOutputCount(payload.imageModel, payload.imageCount);
  if (Number(payload.imageCount || 1) !== imageCount) {
    throw new Error(`${imageProvider.name} 单次最多生成 ${imageProvider.maxOutputCount} 张图片`);
  }
  const recognitionProvider = payload.recognitionProvider === 'gemini-web' ? 'gemini-web' : 'codex-cli';
  // 比例由用户在节点上统一指定，替换图和短视频用同一个值 —— 替换图就是视频首帧，
  // 两者比例不一致时平台只会裁掉或加黑边，而且不报错。这里再按图片模型能力收一次口，
  // 防止切换模型后留下它不支持的比例。
  const aspectRatio = normalizeImageAspectRatio(payload.imageModel, String(payload.aspectRatio || DEFAULT_PRODUCT_SCENE_ASPECT_RATIO));
  // 比例是硬的、模型是软的：所选视频模型撑不住这个比例就换一个撑得住的，
  // 而不是把用户选的比例偷偷改掉。一个都没有时明确拒绝，不做静默裁切。
  const videoChoice = resolveVideoModelForAspectRatio(aspectRatio, payload.videoModel || DEFAULT_PRODUCT_SCENE_VIDEO_MODEL);
  if (payload.autoGenerateVideo && !videoChoice) {
    throw new Error(`当前没有支持 ${aspectRatio} 的图生视频模型，请换一个比例或关闭「自动生成视频」`);
  }
  const videoModel = videoChoice?.modelId || payload.videoModel || DEFAULT_PRODUCT_SCENE_VIDEO_MODEL;
  const videoParameters = normalizeVideoParameters(videoModel, { aspectRatio, duration: payload.videoDuration });
  if (payload.autoGenerateVideo && !String(payload.videoPrompt || '').trim()) {
    throw new Error('自动生成视频已开启，请连接短视频提示词文本节点');
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
  const canReusePartialResults = previous?.status === 'partial_failed'
    && previous.imageModel === payload.imageModel
    && Number(previous.imageCount || 1) === imageCount
    && previous.sceneImage === payload.sceneImage
    && previous.productImage === payload.productImage
    && Array.isArray(previous.resultUrls)
    && previous.resultUrls.length > 0;
  const reusableResultNodeIds = canReusePartialResults && Array.isArray(previous.resultNodeIds)
    ? previous.resultNodeIds
    : Array.from({ length: imageCount }, () => crypto.randomUUID());
  const reusableVideoResultNodeIds = canReusePartialResults && Array.isArray(previous.videoResultNodeIds)
    ? previous.videoResultNodeIds
    : Array.from({ length: imageCount }, () => crypto.randomUUID());
  const reusableVideoTasks = canReusePartialResults && Array.isArray(previous.videoTasks)
    ? previous.videoTasks.map(task => task.status === 'success' || task.retryBlocked
        ? { ...task }
        : { ...task, status: 'waiting', error: undefined, errorCode: undefined, retryBlocked: undefined, resultUrl: undefined })
    : undefined;
  const now = new Date().toISOString();
  const job = {
    id: requestedJobId || crypto.randomUUID(),
    workflowId: payload.workflowId,
    nodeId: payload.nodeId,
    resultNodeIds: reusableResultNodeIds,
    videoResultNodeIds: reusableVideoResultNodeIds,
    status: 'pending',
    stage: 'queued',
    stageLabel: '任务已创建',
    sceneImage: payload.sceneImage,
    productImage: payload.productImage,
    dimensions: payload.dimensions,
    productCategory: payload.productCategory || '',
    preserveProductMarkings: payload.preserveProductMarkings !== false,
    personaBrief: String(payload.personaBrief || '').trim(),
    imageModel: payload.imageModel,
    imageCount,
    imageResolution: payload.imageResolution || 'Auto',
    aspectRatio,
    recognitionProvider,
    recognitionModel: recognitionProvider === 'gemini-web' ? 'Gemini Web' : (context.recognitionModel || 'gpt-5.6-sol'),
    videoPrompt: String(payload.videoPrompt || '').trim(),
    videoPromptSourceId: String(payload.videoPromptSourceId || ''),
    videoModel,
    // 视频比例不再单独存一份，永远等于替换图的比例。
    videoAspectRatio: aspectRatio,
    videoDuration: videoParameters.duration,
    // 换过模型就记下来，界面据此说明「为什么跑的不是我选的那个模型」。
    videoModelSwitchedFrom: videoChoice?.switched ? videoChoice.from : undefined,
    videoResolution: payload.videoResolution || '自动',
    videoGenerateAudio: payload.videoGenerateAudio !== false,
    autoGenerateVideo: payload.autoGenerateVideo === true,
    ...(canReusePartialResults ? {
      resultUrls: previous.resultUrls,
      resultUrl: previous.resultUrl,
      imageResults: previous.imageResults,
      videoTasks: reusableVideoTasks,
    } : {}),
    ...(previous?.sceneAnalysis && previous?.personaAnalysis
      && previous?.compositionAnalysis && previous?.productAnalysis
      ? {
          sceneAnalysis: previous.sceneAnalysis,
          personaAnalysis: previous.personaAnalysis,
          compositionAnalysis: previous.compositionAnalysis,
          productAnalysis: previous.productAnalysis,
        }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
  job.resultNodeId = job.resultNodeIds[0];
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

export function cancelProductSceneJob(jobId, workflowId, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if (!['pending', 'processing'].includes(job.status)) return job;
  job.cancelRequested = true;
  job.stageLabel = '正在结束当前任务，后续视频将不再提交';
  return writeJob(job, context.dirs);
}
