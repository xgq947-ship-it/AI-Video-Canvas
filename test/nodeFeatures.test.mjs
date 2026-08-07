import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requiredFeatureForNode, isPremiumNode, NODE_FEATURE_MAP } from '../shared/nodeFeatures.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 直接用字符串取值（与 src/types.ts 的 NodeType 枚举取值一致）。
// 不 import types.ts：Node 的类型剥离模式不支持 enum。
const PREMIUM = [
  'Cinematic Director',
  'Cinematic Cast',
  'Cinematic Storyboard',
  'Stickman Director',
  'Storyboard Compare',
];

// Cinematic Video Merge 刻意在 FREE 里：它只是本地 ffmpeg 拼接已生成的镜头，
// 不调用云端模型，属于文档 §14.4 允许试用到期后继续用的“导出已有文件”
// （见 shared/nodeFeatures.js 顶部注释）。
const FREE = [
  'Text', 'Image', 'Video', 'Audio', 'Video Analysis', 'Video Merge',
  'Video Remix', 'Flow Batch Video', 'Storyboard', 'Reference Video', 'Render',
  'Cinematic Video Merge',
];

test('导演工作流节点被标为高级 director_workflow', () => {
  for (const t of PREMIUM) {
    assert.equal(requiredFeatureForNode(t), 'director_workflow', `${t} 应为 director_workflow`);
    assert.equal(isPremiumNode(t), true, `${t} 应为高级节点`);
  }
});

test('通用/复用节点保持免费（无功能要求）', () => {
  for (const t of FREE) {
    assert.equal(requiredFeatureForNode(t), undefined, `${t} 不应有功能要求`);
    assert.equal(isPremiumNode(t), false, `${t} 应为免费节点`);
  }
});

test('未知/空节点类型不报错，视为免费', () => {
  assert.equal(requiredFeatureForNode(undefined), undefined);
  assert.equal(requiredFeatureForNode(null), undefined);
  assert.equal(requiredFeatureForNode('Nonexistent Node'), undefined);
  assert.equal(isPremiumNode(''), false);
});

test('映射表所有键都是 src/types.ts 中真实存在的 NodeType 取值（防拼写漂移）', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'src', 'types.ts'), 'utf8');
  const enumBody = src.slice(src.indexOf('export enum NodeType'));
  const valid = new Set();
  // 匹配形如  KEY = 'Value'
  const re = /=\s*'([^']+)'/g;
  const head = enumBody.slice(0, enumBody.indexOf('}'));
  let m;
  while ((m = re.exec(head)) !== null) valid.add(m[1]);
  assert.ok(valid.size >= 10, '未能从 types.ts 解析出足够的 NodeType 取值');
  for (const key of Object.keys(NODE_FEATURE_MAP)) {
    assert.ok(valid.has(key), `映射键 "${key}" 不是有效的 NodeType 取值`);
  }
});
