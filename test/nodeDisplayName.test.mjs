import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filenameFromMediaUrl,
  resolveImageNodeDisplayName,
} from '../src/utils/nodeDisplayName.js';

test('图片显示名按手动名称、文件名、结果名、默认名依次回退且绝不使用 prompt', () => {
  const base = {
    type: 'Image',
    prompt: '这是一整段不应出现在侧边栏的超长提示词',
    resultUrl: '/library/projects/demo/images/generated_001.png?t=1',
    resultName: '任务结果名',
  };
  assert.equal(resolveImageNodeDisplayName({ ...base, displayName: '  我的主图  ' }, 9), '我的主图');
  assert.equal(resolveImageNodeDisplayName(base, 9), 'generated_001.png');
  assert.equal(resolveImageNodeDisplayName({ ...base, resultUrl: 'data:image/png;base64,AAAA' }, 9), '任务结果名');
  assert.equal(
    resolveImageNodeDisplayName({
      type: 'Image',
      prompt: base.prompt,
      imageModel: 'google-flow-nano-banana-pro',
    }, 9),
    'Flow 图片 009'
  );
});

test('媒体 URL 文件名会解码中文并忽略查询参数', () => {
  assert.equal(
    filenameFromMediaUrl('http://127.0.0.1/library/images/%E4%BA%A7%E5%93%81%E5%9B%BE.png?v=2#x'),
    '产品图.png'
  );
  assert.equal(filenameFromMediaUrl('blob:http://127.0.0.1/demo'), '');
});
