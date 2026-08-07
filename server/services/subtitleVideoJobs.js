import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import OpenAI from 'openai';
import {
  buildAlignedSubtitles,
  buildAlignedSubtitlesFromBreakPlan,
  generateAssDocument,
  normalizeTimedWords,
  normalizeTranscriptionSegments,
} from '../../shared/autoSubtitles.js';
import { resolveAssetPath } from '../utils/manifestAssets.js';
import { FFMPEG_PATH, FFPROBE_PATH } from '../runtime/mediaTools.js';
import { runGeminiWebMediaTextTask, runGeminiWebTextTask } from './geminiWebWorkflow.js';
import { decodeProcessOutput } from '../utils/processOutput.js';

const jobs = new Map();
const activeBySource = new Map();
const ACTIVE = new Set(['queued', 'extracting', 'transcribing', 'aligning', 'punctuating', 'rendering']);
const RETENTION_MS = 30 * 60_000;
let encodeQueue = Promise.resolve();

const runInEncodeQueue = (job, task) => {
  const queued = encodeQueue.then(async () => {
    if (job.status === 'cancelled') throw new Error('任务已取消');
    return task();
  });
  encodeQueue = queued.catch(() => {});
  return queued;
};

const parseGeminiSegments = (text) => {
  const source = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseBreakPlan = (text) => {
  const source = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const requestChineseBreakPlan = async ({ words, signal, workflowId, sourceNodeId }) => {
  if (!Array.isArray(words) || words.length < 2 || words.length > 450) return [];
  const indexedWords = words
    .map((word, index) => `${index}:[${word.start.toFixed(2)}-${word.end.toFixed(2)}]${word.text}`)
    .join('\n');
  const prompt = [
    '你只负责给中文口播选择自然断句点。禁止改字、删字、加词或调整顺序。',
    '下面每行是“词下标:[开始秒-结束秒]识别原文”。只返回 JSON 数组，不要 Markdown。',
    '每项格式：{"endWord":整数,"punctuation":"，或。或！或？或；或：或空字符串"}。',
    'endWord 表示本条字幕最后一个词的下标，必须严格递增；每条尽量 6—16 个汉字，最长不超过 16 个字或 5 秒。',
    '最后一项必须覆盖最后一个词。标点只用于显示，不能替代或修改原文。',
    indexedWords,
  ].join('\n');
  const answer = await runGeminiWebTextTask({
    prompt,
    signal,
    workflowId,
    nodeId: sourceNodeId,
  });
  return parseBreakPlan(answer);
};

const transcribeSpeech = async ({ audioPath, duration, openaiApiKey, signal, workflowId, sourceNodeId }) => {
  if (openaiApiKey) {
    try {
      const openai = new OpenAI({ apiKey: openaiApiKey });
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: 'whisper-1',
        language: 'zh',
        response_format: 'verbose_json',
        timestamp_granularities: ['word', 'segment'],
        temperature: 0,
      }, { signal });
      const words = normalizeTimedWords(transcript.words, duration);
      if (words.length > 0) {
        return { words, segments: transcript.segments || [], text: transcript.text || '', engine: 'openai-whisper-word', alignmentQuality: 'word' };
      }
      return {
        words: [],
        segments: normalizeTranscriptionSegments(transcript.segments, duration, transcript.text),
        text: transcript.text || '',
        engine: 'openai-whisper-segment',
        alignmentQuality: 'estimated',
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn(`[AutoSubtitle] OpenAI 转写失败，改用 Gemini Web：${error?.message || error}`);
    }
  }

  const prompt = [
    '请逐字识别附件音频中的真实中文口播，不要概括，不要补写没有说出的内容。',
    `音频总时长约 ${duration.toFixed(3)} 秒。`,
    '只返回 JSON 数组，不要 Markdown。每项格式：{"start":0.0,"end":1.2,"text":"原话"}。',
    '时间单位为秒，必须按实际说话时间标注，不能超出音频总时长。没有有效人声时只返回 []。'
  ].join('\n');
  const answer = await runGeminiWebMediaTextTask({
    prompt,
    files: [{ buffer: fs.readFileSync(audioPath), fileName: 'speech.wav', mimeType: 'audio/wav' }],
    signal,
    workflowId,
    nodeId: sourceNodeId,
  });
  const segments = parseGeminiSegments(answer);
  return {
    words: [],
    segments: normalizeTranscriptionSegments(segments, duration),
    text: segments.map(segment => segment?.text || '').join(''),
    engine: 'gemini-web-segment',
    alignmentQuality: 'estimated',
  };
};

const publicView = (job) => ({
  jobId: job.id,
  workflowId: job.workflowId,
  sourceNodeId: job.sourceNodeId,
  resultNodeId: job.resultNodeId,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  output: job.outputUrl,
  subtitles: job.subtitles,
  durationSec: job.durationSec,
  resultAspectRatio: job.resultAspectRatio,
  transcriptionEngine: job.transcriptionEngine,
  alignmentQuality: job.alignmentQuality,
  subtitleFormat: job.subtitleFormat,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const setStage = (job, stage, progress) => {
  job.status = stage;
  job.stage = stage;
  job.progress = progress;
  job.updatedAt = new Date().toISOString();
};

const runProcess = (command, args, job, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  child.once('error', reject);
  child.once('close', (code, signal) => {
    job.child = null;
    if (job.status === 'cancelled') return reject(new Error('任务已取消'));
    if (code === 0) return resolve({ stdout: decodeProcessOutput(stdout), stderr: decodeProcessOutput(stderr) });
    reject(new Error(signal
      ? `媒体处理被信号 ${signal} 中止`
      : `媒体处理失败 (${code}): ${decodeProcessOutput(stderr).slice(-500)}`));
  });
});

const probeVideo = async (videoPath, job) => {
  const { stdout } = await runProcess(FFPROBE_PATH, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate:format=duration',
    '-of', 'json', videoPath,
  ], job);
  const parsed = JSON.parse(stdout || '{}');
  const stream = parsed.streams?.[0] || {};
  const duration = Number(parsed.format?.duration);
  const [fpsNum, fpsDen] = String(stream.avg_frame_rate || '24/1').split('/').map(Number);
  const fps = fpsNum > 0 && fpsDen > 0 ? Math.min(60, fpsNum / fpsDen) : 24;
  if (!(duration > 0) || !(stream.width > 0) || !(stream.height > 0)) throw new Error('无法读取视频尺寸或时长');
  return { duration, width: stream.width, height: stream.height, fps };
};

export const pruneSubtitleVideoJobs = (now = Date.now()) => {
  for (const [id, job] of jobs) {
    if (ACTIVE.has(job.status)) continue;
    if (now - Date.parse(job.updatedAt) > RETENTION_MS) jobs.delete(id);
  }
};

export const getSubtitleVideoJob = (id) => {
  const job = jobs.get(id);
  return job ? publicView(job) : null;
};

export const createSubtitleVideoJob = ({
  workflowId,
  sourceNodeId,
  resultNodeId,
  sourceVideoUrl,
  libraryDir,
  outputDir,
  outputUrlPrefix,
  openaiApiKey,
}) => {
  pruneSubtitleVideoJobs();
  const activeId = activeBySource.get(`${workflowId}:${sourceNodeId}`);
  const active = activeId ? jobs.get(activeId) : null;
  if (active && ACTIVE.has(active.status)) return { error: '这个视频正在生成字幕', code: 409, existing: publicView(active) };

  let sourcePath;
  try {
    sourcePath = resolveAssetPath(libraryDir, sourceVideoUrl);
  } catch (error) {
    return { error: error.message, code: 400 };
  }
  if (!fs.existsSync(sourcePath)) return { error: '源视频不存在', code: 400 };

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const job = {
    id, workflowId, sourceNodeId, resultNodeId, sourceVideoUrl, sourcePath,
    status: 'queued', stage: 'queued', progress: 0, outputUrl: null, outputPath: null,
    subtitles: [], durationSec: null, resultAspectRatio: null, error: null,
    transcriptionEngine: null, alignmentQuality: null, subtitleFormat: null,
    createdAt: now, updatedAt: now, child: null, canceller: null, abortController: new AbortController(),
  };
  jobs.set(id, job);
  activeBySource.set(`${workflowId}:${sourceNodeId}`, id);

  void (async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-auto-subtitle-'));
    const audioPath = path.join(tempDir, 'speech.wav');
    try {
      const metadata = await probeVideo(sourcePath, job);
      job.durationSec = metadata.duration;
      job.resultAspectRatio = `${metadata.width}/${metadata.height}`;

      setStage(job, 'extracting', 0.08);
      try {
        await runProcess(FFMPEG_PATH, [
          '-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath,
          '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath,
        ], job);
      } catch (error) {
        throw new Error(/does not contain any stream|matches no streams|Output file does not contain/i.test(error.message)
          ? '未检测到视频音轨，无法自动生成字幕'
          : error.message);
      }
      if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size < 1024) throw new Error('未检测到有效人声');

      setStage(job, 'transcribing', 0.22);
      const transcription = await transcribeSpeech({
        audioPath,
        duration: metadata.duration,
        openaiApiKey,
        signal: job.abortController.signal,
        workflowId,
        sourceNodeId,
      });
      job.transcriptionEngine = transcription.engine;
      job.alignmentQuality = transcription.alignmentQuality;

      setStage(job, 'aligning', 0.42);
      let subtitles = transcription.words.length > 0
        ? buildAlignedSubtitles(transcription.words, metadata.duration)
        : transcription.segments;

      if (transcription.words.length > 0) {
        setStage(job, 'punctuating', 0.52);
        try {
          const breakPlan = await requestChineseBreakPlan({
            words: transcription.words,
            signal: job.abortController.signal,
            workflowId,
            sourceNodeId,
          });
          const aiSubtitles = buildAlignedSubtitlesFromBreakPlan(
            transcription.words,
            metadata.duration,
            breakPlan,
          );
          if (aiSubtitles.length > 0) subtitles = aiSubtitles;
        } catch (error) {
          if (job.abortController.signal.aborted) throw error;
          console.warn(`[AutoSubtitle] AI 中文断句不可用，保留词级时间轴并使用本地断句：${error?.message || error}`);
        }
      }
      if (subtitles.length === 0) throw new Error('未识别到有效口播');
      job.subtitles = subtitles;

      setStage(job, 'rendering', 0.65);
      fs.mkdirSync(outputDir, { recursive: true });
      const outputName = `subtitle_${Date.now()}_${id.slice(0, 8)}.mp4`;
      job.outputPath = path.join(outputDir, outputName);
      const assPath = path.join(tempDir, 'captions.ass');
      fs.writeFileSync(assPath, generateAssDocument(subtitles, metadata), 'utf8');
      job.subtitleFormat = 'ass';
      await runInEncodeQueue(job, async () => {
        await runProcess(FFMPEG_PATH, [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', sourcePath,
          '-map', '0:v:0', '-map', '0:a?',
          '-vf', 'ass=captions.ass',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
          '-c:a', 'aac', '-b:a', '192k',
          '-movflags', '+faststart',
          job.outputPath,
        ], job, { cwd: tempDir });
      });
      job.outputUrl = `${outputUrlPrefix}/${encodeURIComponent(outputName)}`;
      job.status = 'success';
      job.stage = 'done';
      job.progress = 1;
      job.updatedAt = new Date().toISOString();
    } catch (error) {
      console.error('[AutoSubtitle] task failed:', error?.stack || error);
      const cancelled = job.status === 'cancelled' || error?.name === 'AbortError' || /cancel|取消/i.test(error?.message || '');
      job.status = cancelled ? 'cancelled' : 'failed';
      job.stage = job.status;
      job.error = cancelled ? '任务已取消' : (error?.message || String(error));
      job.updatedAt = new Date().toISOString();
      if (job.outputPath && fs.existsSync(job.outputPath)) fs.rmSync(job.outputPath, { force: true });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      job.child = null;
      job.canceller = null;
      job.abortController = null;
      if (activeBySource.get(`${workflowId}:${sourceNodeId}`) === id) activeBySource.delete(`${workflowId}:${sourceNodeId}`);
    }
  })();

  return { job: publicView(job) };
};

export const cancelSubtitleVideoJob = (id) => {
  const job = jobs.get(id);
  if (!job) return { error: '任务不存在', code: 404 };
  if (!ACTIVE.has(job.status)) return { error: `任务状态为 ${job.status}，无法取消`, code: 400 };
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.updatedAt = new Date().toISOString();
  job.abortController?.abort();
  job.canceller?.();
  job.child?.kill('SIGTERM');
  return { job: publicView(job) };
};

export const _resetSubtitleVideoJobs = () => {
  for (const job of jobs.values()) {
    job.abortController?.abort();
    job.canceller?.();
    job.child?.kill('SIGTERM');
  }
  jobs.clear();
  activeBySource.clear();
};
