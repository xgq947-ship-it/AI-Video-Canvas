/**
 * 用 ffmpeg 生成本地测试素材（不调用任何付费 API），用于验证端到端渲染。
 * 生成：2 个视频镜头 + 1 条对白 + 1 条音效 + 1 条背景音乐。
 *
 * 用法： node scripts/generate-test-assets.mjs [目标library目录]
 * 默认写入 <project>/library 下的 videos/ 与 audio/。
 */
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { FFMPEG_PATH } from '../server/runtime/mediaTools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_PATH, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg 失败(${c}): ${err.slice(-400)}`))));
  });

export const generateTestAssets = async (libraryDir) => {
  const videosDir = path.join(libraryDir, 'videos');
  const audioDir = path.join(libraryDir, 'audio');
  fs.mkdirSync(videosDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  const v1 = path.join(videosDir, 'test_shot1.mp4');
  const v2 = path.join(videosDir, 'test_shot2.mp4');
  const dialogue = path.join(audioDir, 'test_dialogue.mp3');
  const sfx = path.join(audioDir, 'test_sfx.mp3');
  const bgm = path.join(audioDir, 'test_bgm.mp3');

  // 镜头1：蓝色动态测试图，30fps，4秒
  await run([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-t', '4', v1,
  ]);
  // 镜头2：SMPTE 彩条，25fps，5秒（不同源尺寸/帧率，验证通用性）
  await run([
    '-f', 'lavfi', '-i', 'smptebars=size=1364x768:rate=25:duration=5',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-t', '5', v2,
  ]);
  // 对白：440Hz 正弦，3秒
  await run([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:a', 'libmp3lame', '-b:a', '128k', dialogue,
  ]);
  // 音效：880Hz，0.8秒
  await run([
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.8',
    '-c:a', 'libmp3lame', '-b:a', '128k', sfx,
  ]);
  // 背景音乐：220Hz 低频铺底，9秒
  await run([
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=9',
    '-c:a', 'libmp3lame', '-b:a', '128k', bgm,
  ]);

  return {
    videos: [v1, v2],
    audio: { dialogue, sfx, bgm },
    // 清单里使用的相对地址（前端风格 /library/...）
    refs: {
      v1: '/library/videos/test_shot1.mp4',
      v2: '/library/videos/test_shot2.mp4',
      dialogue: '/library/audio/test_dialogue.mp3',
      sfx: '/library/audio/test_sfx.mp3',
      bgm: '/library/audio/test_bgm.mp3',
    },
  };
};

/** 组装用于测试的清单 */
export const buildTestManifest = (refs) => ({
  project: { id: 'test-e2e', title: '端到端测试成片' },
  composition: { width: 1280, height: 720, fps: 24 },
  shots: [
    { id: 'shot-001', name: '镜头1', file: refs.v1, start: 0, end: 4, volume: 0, order: 1 },
    { id: 'shot-002', name: '镜头2', file: refs.v2, start: 0, end: 5, volume: 0, order: 2 },
  ],
  audioTracks: [
    { id: 'aud-dialogue', type: 'dialogue', file: refs.dialogue, start: 1, end: 4, volume: 1 },
    { id: 'aud-sfx', type: 'sfx', file: refs.sfx, start: 5, end: 5.8, volume: 0.8 },
    { id: 'aud-bgm', type: 'bgm', file: refs.bgm, start: 0, end: 9, volume: 0.15, fadeIn: 1, fadeOut: 1, ducking: true, loop: true },
  ],
  output: { endFadeToBlack: 0.6 },
});

// 直接运行则生成到默认 library
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || path.join(projectRoot, 'library');
  generateTestAssets(target)
    .then((r) => console.log('测试素材已生成:', JSON.stringify(r.refs, null, 2)))
    .catch((e) => { console.error(e); process.exit(1); });
}
