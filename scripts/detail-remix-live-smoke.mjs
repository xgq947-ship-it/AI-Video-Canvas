#!/usr/bin/env node

/**
 * Real-provider smoke test for the detail-remix pipeline.
 *
 * It copies a small, user-selected slice of an existing project into an
 * isolated temporary library, then runs real Codex recognition and queues one
 * real Codex image result. The source project is never modified.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cancelDetailRemixJob,
  createDetailRemixJob,
  getDetailRemixJob,
} from '../server/services/detailRemixJobs.js';

const args = process.argv.slice(2);
const localDryRun = args.includes('--local-dry-run');
const option = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const projectJsonPath = path.resolve(option('--project'));
if (!option('--project') || !fs.existsSync(projectJsonPath)) {
  throw new Error('Usage: node scripts/detail-remix-live-smoke.mjs --project <project.json> [--own-count 4] [--competitor-index 0]');
}

const sourceProjectRoot = path.dirname(projectJsonPath);
const source = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
const controller = (source.nodes || []).find(node => (
  node.type === 'Detail Page Remix' && node.detailRemix?.inputRefs
));
if (!controller) throw new Error('项目中没有可用的商品详情复刻控制节点');

const ownCount = Math.max(1, Number(option('--own-count', '4')) || 4);
const competitorIndex = Math.max(0, Number(option('--competitor-index', '0')) || 0);
const ownIds = (controller.detailRemix.inputRefs.ownDetailNodeIds || []).slice(0, ownCount);
const competitorId = controller.detailRemix.inputRefs.competitorDetailNodeIds?.[competitorIndex];
const byId = new Map((source.nodes || []).map(node => [node.id, node]));
if (!ownIds.length || !competitorId) throw new Error('控制节点缺少真实的我方详情或竞品详情输入');

const smokeRoot = option('--output-root')
  ? path.resolve(option('--output-root'))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'evan-detail-remix-live-'));
const libraryDir = path.join(smokeRoot, 'library');
const workflowsDir = path.join(libraryDir, 'workflows');
const projectsDir = path.join(libraryDir, 'projects');
const codexJobsDir = path.join(libraryDir, 'codex-image-jobs');
const workflowId = 'detail-remix-live-smoke';
const projectDirName = '真实详情联调';
const smokeProjectRoot = path.join(projectsDir, projectDirName);
const smokeImagesDir = path.join(smokeProjectRoot, 'images');
fs.mkdirSync(workflowsDir, { recursive: true });
fs.mkdirSync(smokeImagesDir, { recursive: true });
fs.mkdirSync(codexJobsDir, { recursive: true });
fs.writeFileSync(path.join(workflowsDir, `${workflowId}.json`), JSON.stringify({
  id: workflowId,
  title: projectDirName,
  projectDirName,
  nodes: [],
  groups: [],
}, null, 2));

function sourcePathForNode(node) {
  const value = String(node?.resultUrl || node?.editorBackgroundUrl || '').split(/[?#]/)[0];
  const filename = decodeURIComponent(value.split('/').at(-1) || '');
  if (!filename || path.basename(filename) !== filename) throw new Error(`节点 ${node?.id || ''} 没有可读取的项目图片`);
  const candidate = path.join(sourceProjectRoot, 'images', filename);
  if (!fs.existsSync(candidate)) throw new Error(`真实素材不存在：${candidate}`);
  return candidate;
}

function pixelDimensions(node) {
  const [width, height] = String(node?.resultAspectRatio || '').split('/').map(Number);
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    ? { sourceWidth: width, sourceHeight: height }
    : {};
}

function copyInput(node, role, index) {
  const sourcePath = sourcePathForNode(node);
  const extension = path.extname(sourcePath) || '.png';
  const filename = `${role}-${String(index + 1).padStart(2, '0')}${extension}`;
  fs.copyFileSync(sourcePath, path.join(smokeImagesDir, filename));
  return {
    nodeId: `${role}-${index + 1}`,
    imageUrl: `/library/projects/${encodeURIComponent(projectDirName)}/images/${encodeURIComponent(filename)}`,
    order: index,
    ...pixelDimensions(node),
  };
}

const ownDetails = ownIds.map((id, index) => copyInput(byId.get(id), 'own', index));
const competitorDetails = [copyInput(byId.get(competitorId), 'competitor', 0)];
const context = {
  dirs: { workflowsDir, projectsDir },
  libraryDir,
  codexJobsDir,
  recognitionModel: option('--model', 'gpt-5.6-luna'),
  recognitionTimeoutMs: Math.max(60_000, Number(option('--recognition-timeout-ms', '600000')) || 600_000),
  codexTimeoutMs: Math.max(60_000, Number(option('--image-timeout-ms', '3600000')) || 3_600_000),
  codexPollIntervalMs: 1_000,
};
if (localDryRun) {
  context.runRecognition = async (_request, meta) => {
    if (meta.kind === 'own-selling-points') {
      return JSON.stringify({
        brandIdentity: { brandName: 'PHILIPS' },
        productViews: [{
          sourceImageIndex: 0,
          cropRegion: { x: 0.18, y: 0.38, width: 0.68, height: 0.58 },
          viewAngle: 'rear-left worn view',
          visibleSides: ['rear', 'left'],
          description: '真实详情中的颈肩按摩披肩与控制带',
          quality: 0.9,
        }],
        sellingPoints: [{
          id: 'sp-live-1',
          title: '肩颈斜方肌舒缓',
          description: '多按摩头揉捏并支持双档热敷',
          sourceImageIndexes: [0, 1, 2, 3],
        }],
      });
    }
    return JSON.stringify({
      page: {
        hasPerson: true,
        reversePrompt: '竖版家居场景，侧后方人物佩戴颈肩按摩披肩，上方保留标题区',
        productRegion: { x: 0.28, y: 0.42, width: 0.55, height: 0.42 },
        selectedProductViewIds: ['pv-1'],
        mappedSellingPoints: [{ sellingPointId: 'sp-live-1' }],
      },
    });
  };
  context.generateImage = async () => {
    const value = decodeURIComponent(competitorDetails[0].imageUrl.split('/').at(-1));
    return { buffer: fs.readFileSync(path.join(smokeImagesDir, value)), extension: path.extname(value).slice(1) || 'png' };
  };
}

const job = createDetailRemixJob({
  workflowId,
  nodeId: 'detail-remix-live-controller',
  ownDetails,
  competitorDetails,
  productImages: [],
  productNodeIds: [],
  characterReferenceImages: [],
  characterReferenceNodeIds: [],
  useCharacterReference: false,
  recognitionProvider: 'codex-cli',
  imageModel: 'codex-imagegen',
  resolution: '2K',
  sizingMode: 'match-competitor',
}, context);

process.stdout.write(`${JSON.stringify({
  smokeRoot,
  libraryDir,
  jobId: job.id,
  sourceOwnImages: ownDetails.length,
  sourceCompetitorImage: competitorIndex + 1,
  mode: localDryRun ? 'local-dry-run' : 'real-codex',
  queueCommand: `EVAN_LIBRARY_DIR=${libraryDir} node scripts/codex-image-queue.mjs list`,
}, null, 2)}\n`);

let lastSignature = '';
let stopping = false;
process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  cancelDetailRemixJob(job.id, workflowId, context);
});

const terminal = new Set(['completed', 'partial_failed', 'failed', 'cancelled', 'recovery_required']);
while (true) {
  const current = getDetailRemixJob(job.id, workflowId, context);
  const signature = JSON.stringify({
    status: current.status,
    stage: current.stage,
    stageLabel: current.stageLabel,
    productViews: current.ownRecognition?.productViewCount || 0,
    pageStatus: current.pages?.[0]?.status,
    recognitionStatus: current.pages?.[0]?.recognitionStatus,
    codexImageJobId: current.pages?.[0]?.codexImageJobId,
    resultUrl: current.pages?.[0]?.resultUrl,
    error: current.error,
  });
  if (signature !== lastSignature) {
    lastSignature = signature;
    process.stdout.write(`${signature}\n`);
  }
  if (terminal.has(String(current.status))) {
    if (current.status !== 'completed') process.exitCode = 1;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1_000));
}
