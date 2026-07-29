import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readProjectAssetMetadata,
  resolveProjectAssetDisplayName,
  updateProjectAssetDisplayName,
} from '../server/services/projectAssetNames.js';

test('项目资产名称优先 displayName 与真实文件名，不再回退到 prompt', () => {
  assert.equal(
    resolveProjectAssetDisplayName({ displayName: '  首页主图 ', prompt: '超长提示词' }, 'generated.png'),
    '首页主图'
  );
  assert.equal(
    resolveProjectAssetDisplayName({ prompt: '超长提示词', resultName: '任务名称' }, 'generated.png'),
    'generated.png'
  );
  assert.equal(resolveProjectAssetDisplayName({ resultName: '任务名称' }, ''), '任务名称');
  assert.equal(resolveProjectAssetDisplayName({}, '', { type: 'images', index: 2 }), '图片 002');
});

test('双击重命名只写 sidecar displayName，不修改媒体文件名或路径', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-asset-name-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageDir = path.join(root, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  fs.writeFileSync(path.join(imageDir, 'generated.png'), 'pixels');
  fs.writeFileSync(path.join(imageDir, 'generated.json'), JSON.stringify({
    id: 'asset-1',
    filename: 'generated.png',
    prompt: '不应作为名称的提示词',
  }));

  const metadata = updateProjectAssetDisplayName(root, 'images', 'generated.png', '  新名称  ');
  assert.equal(metadata.displayName, '新名称');
  assert.equal(fs.existsSync(path.join(imageDir, 'generated.png')), true);
  assert.equal(fs.existsSync(path.join(imageDir, '新名称.png')), false);
  assert.equal(readProjectAssetMetadata(imageDir, 'generated.png').metadata.displayName, '新名称');
  assert.throws(
    () => updateProjectAssetDisplayName(root, 'images', 'generated.png', '   '),
    /名称不能为空/
  );
});
