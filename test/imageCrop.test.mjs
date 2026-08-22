import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('图片节点的裁剪入口一路接到弹窗，结果落盘成项目文件而不是 data URL', () => {
  const toolbar = read('src/components/canvas/NodeHoverToolbar.tsx');
  const canvasNode = read('src/components/canvas/CanvasNode.tsx');
  const app = read('src/App.tsx');
  const hook = read('src/hooks/useImageCrop.ts');

  // 入口只给图片节点：视频和相机节点的动作表不含 crop。
  assert.match(toolbar, /case 'crop':/);
  assert.match(canvasNode, /const imageToolbarActions[\s\S]*?'crop',[\s\S]*?\];/);
  assert.doesNotMatch(canvasNode, /const videoToolbarActions[\s\S]*?'crop'[\s\S]*?\];/);

  // 节点回调走 ref 转发，保持传给 CanvasNode 的引用稳定。
  assert.match(app, /onCrop: \(id: string\) => nodeCallbacksRef\.current\.handleOpenImageCrop\(id\)/);
  assert.match(app, /onCrop=\{stableNodeHandlers\.onCrop\}/);
  assert.match(app, /<ImageCropModal/);

  // 裁剪改变了尺寸，画幅必须一起更新，否则新图会被按旧比例拉伸。
  assert.match(hook, /resultAspectRatio: uploaded\.resultAspectRatio/);
  assert.match(hook, /aspectRatio: uploaded\.aspectRatio/);

  // 落盘失败时保留原图。服务端保存工作流会清掉 base64，
  // 退回 data URL 等于让这张图在下次保存后消失。
  assert.match(hook, /uploadProjectImage\(workflowId, blob/);
  assert.doesNotMatch(hook, /resultUrl: croppedDataUrl/);
});

test('裁剪 UI 只在不缩放的弹窗里出现，避免画布缩放把拖拽坐标算错', () => {
  const modal = read('src/components/modals/ImageCropModal.tsx');
  const canvasNode = read('src/components/canvas/CanvasNode.tsx');

  // useImageEditorCrop 混用 getBoundingClientRect（受 transform 影响）和
  // clientWidth（不受影响），放进画布的 scale(zoom) 里两者会差一个缩放倍数。
  assert.match(modal, /useImageEditorCrop/);
  assert.doesNotMatch(canvasNode, /useImageEditorCrop/);
  assert.match(modal, /className="fixed inset-0/);
});
