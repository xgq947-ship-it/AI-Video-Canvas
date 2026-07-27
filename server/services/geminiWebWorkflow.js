import fs from 'fs';
import os from 'os';
import path from 'path';

import { runOpsCli } from './opsCliRunner.js';
import { enqueueBrowserWorkflow } from './googleFlowWorkflowQueue.js';
import { loadBrowserImageResults, resolveBrowserReferenceImages } from './googleFlowImageWorkflow.js';

export const GEMINI_WEB_IMAGE_MODEL_ID = 'gemini-web-image';
export const GEMINI_WEB_VIDEO_MODEL_ID = 'gemini-web-video';

export const isGeminiWebImageModel = modelId => modelId === GEMINI_WEB_IMAGE_MODEL_ID;
export const isGeminiWebVideoModel = modelId => modelId === GEMINI_WEB_VIDEO_MODEL_ID;

const cleanupTaskDir = taskDir => {
  try { fs.rmSync(taskDir, { recursive: true, force: true }); }
  catch (error) { console.warn(`[Gemini Web] 临时目录清理失败：${error.message}`); }
};

const loadVideoResult = async data => {
  const videoPath = data?.video_path;
  if (videoPath && fs.existsSync(videoPath)) {
    return { buffer: fs.readFileSync(videoPath), extension: path.extname(videoPath).slice(1) || 'mp4', source: 'file' };
  }
  const videoUrl = data?.video_url;
  if (typeof videoUrl === 'string' && /^https?:\/\//.test(videoUrl)) {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Gemini Web 视频下载失败：HTTP ${response.status}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), extension: 'mp4', source: 'url' };
  }
  throw new Error('Gemini Web 已完成生成，但没有返回可保存的视频结果');
};

export function buildGeminiWebImageArgs({ prompt, aspectRatio, referenceImages = [], outputDir, timeoutMinutes }) {
  const args = [
    'text-to-image', 'gemini-web', 'generate', '--prompt', String(prompt).trim(),
    '--aspect-ratio', aspectRatio, '--count', '1', '--output-dir', outputDir,
    '--timeout-minutes', String(timeoutMinutes),
  ];
  referenceImages.forEach(value => args.push('--reference-image', value));
  args.push('--execute');
  return args;
}

export function buildGeminiWebVideoArgs({ prompt, aspectRatio, duration, referenceImages = [], outputDir, timeoutMinutes, cameraMovement = '', nativeAudio = true }) {
  const args = [
    'image-to-video', 'gemini-web', 'generate', '--prompt', String(prompt).trim(),
    '--aspect-ratio', aspectRatio, '--duration', String(duration), '--output-dir', outputDir,
    '--timeout-minutes', String(timeoutMinutes), '--camera-movement', cameraMovement,
    nativeAudio ? '--native-audio' : '--no-native-audio',
  ];
  referenceImages.forEach(value => args.push('--reference-image', value));
  args.push('--execute');
  return args;
}

async function executeImage({ prompt, aspectRatio = '1:1', referenceImageInputs = [], libraryDir, timeoutMinutes = 10, signal }) {
  if (!String(prompt || '').trim()) throw new Error('Gemini Web 图片提示词不能为空');
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-gemini-web-image-'));
  try {
    const outputDir = path.join(taskDir, 'output');
    const references = await resolveBrowserReferenceImages(referenceImageInputs, libraryDir, taskDir, { providerName: 'Gemini Web' });
    const { data, runId } = await runOpsCli({
      label: 'Gemini Web 图片生成', timeoutMs: (timeoutMinutes + 2) * 60_000,
      signal,
      args: buildGeminiWebImageArgs({ prompt, aspectRatio, referenceImages: references, outputDir, timeoutMinutes }),
    });
    const images = await loadBrowserImageResults(data, { providerName: 'Gemini Web 图片生成' });
    return { images, ...images[0], runId };
  } finally { cleanupTaskDir(taskDir); }
}

async function executeVideo({ prompt, referenceImageInputs = [], aspectRatio = '16:9', duration = 8, libraryDir, timeoutMinutes = 15, cameraMovement = '', nativeAudio = true, signal }) {
  if (!String(prompt || '').trim()) throw new Error('Gemini Web 视频提示词不能为空');
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-gemini-web-video-'));
  try {
    const outputDir = path.join(taskDir, 'output');
    const references = await resolveBrowserReferenceImages(referenceImageInputs, libraryDir, taskDir, { providerName: 'Gemini Web' });
    const { data, runId } = await runOpsCli({
      label: 'Gemini Web 视频生成', timeoutMs: (timeoutMinutes + 2) * 60_000,
      signal,
      args: buildGeminiWebVideoArgs({ prompt, aspectRatio, duration, referenceImages: references, outputDir, timeoutMinutes, cameraMovement, nativeAudio }),
    });
    return { ...(await loadVideoResult(data)), runId };
  } finally { cleanupTaskDir(taskDir); }
}

export const generateGeminiWebImage = options => enqueueBrowserWorkflow(
  () => executeImage(options),
  { label: 'Gemini Web 图片生成', signal: options?.signal }
);
export const generateGeminiWebVideo = options => enqueueBrowserWorkflow(
  () => executeVideo(options),
  { label: 'Gemini Web 视频生成', signal: options?.signal }
);

/**
 * 识图 / 提示词优化同样在驱动那一个 Evan 专属 Chrome，必须和生成走同一条串行队列。
 *
 * 之前它是唯一没入队的浏览器任务：产品短视频节点先用 Gemini 识图（未入队）、再排队生图，
 * 识图期间任何入队任务或界面上的「打开浏览器 / 检查登录」都会同时操作同一个 Chrome，
 * 而 ops-cli 的工作页是 cleanup_before=True —— 后来者会直接关掉正在用的页面。
 *
 * 调用方（optimize-prompt、reverse-image-prompt、产品短视频识图）都不在队列任务内部，
 * 因此这里入队不会产生嵌套死锁。
 */
export const runGeminiWebTextTask = options =>
  enqueueBrowserWorkflow(
    () => executeTextTask(options),
    { label: 'Gemini Web 识图', signal: options?.signal }
  );

async function executeTextTask({ prompt, referenceImageInputs = [], libraryDir, timeoutMinutes = 5, signal }) {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-gemini-web-text-'));
  try {
    const references = await resolveBrowserReferenceImages(referenceImageInputs, libraryDir, taskDir, { providerName: 'Gemini Web' });
    const args = ['gemini-web', 'ask', '--prompt', String(prompt).trim(), '--timeout-minutes', String(timeoutMinutes)];
    references.forEach(value => args.push('--reference-image', value));
    const { data } = await runOpsCli({
      label: 'Gemini Web 文本任务',
      timeoutMs: (timeoutMinutes + 2) * 60_000,
      args,
      signal
    });
    const text = String(data?.text || '').trim();
    if (!text) throw new Error('Gemini Web 没有返回文本回答');
    return text;
  } finally { cleanupTaskDir(taskDir); }
}
