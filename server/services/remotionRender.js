/**
 * server/services/remotionRender.js
 *
 * 通用漫剧渲染服务：程序化调用 Remotion（@remotion/bundler + @remotion/renderer）
 * 由 project-manifest 驱动，输出 H.264 + AAC MP4，再用 ffmpeg loudnorm 做响度母带。
 *
 * 重依赖（bundler/renderer）在函数内动态 import —— 无密钥/无渲染需求时不影响服务启动。
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { validateManifestShape, computeTotalDurationSec } from '../../shared/manifest.js';
import { findMissingAssets } from '../utils/manifestAssets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const REMOTION_ENTRY = path.join(PROJECT_ROOT, 'remotion', 'index.ts');

// 缓存 bundle 结果（同一进程内复用，避免每次渲染重新打包）
let cachedServeUrl = null;

/**
 * 用参数数组调用 ffmpeg（绝不拼接 shell 字符串），做 loudnorm 响度母带。
 * @returns {Promise<void>}
 */
const ffmpegMaster = (inputPath, outputPath, onLog) =>
  new Promise((resolve, reject) => {
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'copy',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      outputPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (onLog) onLog(d.toString());
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg loudnorm 失败 (code ${code}): ${stderr.slice(-500)}`));
    });
  });

/**
 * 渲染一个清单为最终 MP4。
 * @param {object} opts
 * @param {any}    opts.manifest        项目清单
 * @param {string} opts.libraryDir      素材根目录（= publicDir）
 * @param {string} opts.outputPath      最终成片输出绝对路径（.mp4）
 * @param {(p:{stage:string,progress:number})=>void} [opts.onProgress]
 * @param {(line:string)=>void} [opts.onLog]
 * @param {import('@remotion/renderer').CancelSignal} [opts.cancelSignal] Remotion 取消信号
 * @param {boolean} [opts.master=true]  是否做 loudnorm 母带
 * @returns {Promise<{output:string, durationSec:number}>}
 */
export const renderManifest = async ({
  manifest,
  libraryDir,
  outputPath,
  onProgress,
  onLog,
  cancelSignal,
  master = true,
}) => {
  // 1) 结构校验
  const shape = validateManifestShape(manifest);
  if (!shape.valid) {
    throw new Error('清单校验失败: ' + shape.errors.join('; '));
  }
  // 2) 素材存在性 + 路径安全
  const missing = findMissingAssets(libraryDir, manifest);
  if (missing.length > 0) {
    const list = missing.map((m) => `${m.kind}:${m.raw}(${m.reason})`).join(', ');
    const err = new Error('缺失素材: ' + list);
    err.missing = missing;
    throw err;
  }

  const log = (s) => { if (onLog) onLog(s); };
  const report = (stage, progress) => { if (onProgress) onProgress({ stage, progress }); };

  // 3) 动态载入重依赖
  const { bundle } = await import('@remotion/bundler');
  const { selectComposition, renderMedia, ensureBrowser } = await import('@remotion/renderer');

  report('preparing', 0.01);
  await ensureBrowser();

  // 4) 打包（首次）
  if (!cachedServeUrl) {
    report('bundling', 0.02);
    cachedServeUrl = await bundle({
      entryPoint: REMOTION_ENTRY,
      publicDir: libraryDir,
      onProgress: (p) => {
        report('bundling', 0.02 + (p / 100) * 0.08);
        log(`bundle ${p}%`);
      },
    });
  }

  const inputProps = { manifest };
  report('composing', 0.11);
  const composition = await selectComposition({
    serveUrl: cachedServeUrl,
    id: 'Manga',
    inputProps,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 有母带时先渲染到临时文件，再由 ffmpeg 输出最终文件
  const renderTarget = master
    ? path.join(path.dirname(outputPath), '.pre_' + path.basename(outputPath))
    : outputPath;

  report('rendering', 0.12);
  await renderMedia({
    composition,
    serveUrl: cachedServeUrl,
    codec: 'h264',
    audioCodec: 'aac',
    outputLocation: renderTarget,
    inputProps,
    cancelSignal,
    onProgress: ({ progress }) => {
      report('rendering', 0.12 + progress * (master ? 0.78 : 0.86));
      if (Math.round(progress * 100) % 10 === 0) log(`render ${(progress * 100).toFixed(0)}%`);
    },
  });

  if (master) {
    report('mastering', 0.92);
    await ffmpegMaster(renderTarget, outputPath, log);
    try { fs.unlinkSync(renderTarget); } catch { /* ignore */ }
  }

  report('done', 1);
  return { output: outputPath, durationSec: computeTotalDurationSec(manifest) };
};

export const _resetBundleCache = () => { cachedServeUrl = null; };
