import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const generationSource = fs.readFileSync(path.join(root, 'src/hooks/useGeneration.ts'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'src/utils/videoHelpers.ts'), 'utf8');

test('视频生成不会因尾帧 seek 失败而一直停在生成中', () => {
  assert.match(generationSource, /视频已生成，但尾帧提取失败，继续保存视频结果/);
  assert.match(generationSource, /lastFrame = await extractVideoLastFrame\(resultUrl\)/);
});

test('尾帧提取有超时并避开精确 seek 到视频 duration', () => {
  assert.match(helperSource, /timeoutMs = 15_000/);
  assert.match(helperSource, /视频尾帧提取超时/);
  assert.match(helperSource, /duration - 0\.05/);
});
