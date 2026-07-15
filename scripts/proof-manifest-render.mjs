// 端到端验证：生成 ffmpeg 测试素材 -> 组装清单 -> 通用渲染 -> ffprobe 验收。
import path from 'path';
import { fileURLToPath } from 'url';
import { generateTestAssets, buildTestManifest } from './generate-test-assets.mjs';
import { renderManifest } from '../server/services/remotionRender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const libraryDir = path.join(root, 'library');

const run = async () => {
  console.log('生成测试素材...');
  const { refs } = await generateTestAssets(libraryDir);
  const manifest = buildTestManifest(refs);
  const outputPath = path.join(libraryDir, 'renders', 'manga-e2e-test.mp4');
  console.log('开始渲染...');
  const res = await renderManifest({
    manifest,
    libraryDir,
    outputPath,
    onProgress: ({ stage, progress }) =>
      process.stdout.write(`\r[${stage}] ${(progress * 100).toFixed(0)}%          `),
  });
  console.log('\n完成 ->', res.output, '  预期时长(s):', res.durationSec);
};

run().catch((e) => { console.error('\n渲染失败:', e); process.exit(1); });
