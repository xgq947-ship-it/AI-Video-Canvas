import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTransientRemotionServerError,
  normalizeTranscriptionSegments,
  splitSubtitleText,
} from '../shared/autoSubtitles.js';

test('短视频字幕按标点和最大字符数断句', () => {
  assert.deepEqual(splitSubtitleText('大家好，今天给大家介绍这款非常好用的按摩仪。'), [
    '大家好，',
    '今天给大家介绍这款非常好用的',
    '按摩仪。',
  ]);
});

test('识别段落被限制在视频时长内并保持连续时间', () => {
  const result = normalizeTranscriptionSegments([
    { start: -1, end: 8, text: '第一句话。第二句话！', no_speech_prob: 0.02, avg_logprob: -0.2 },
  ], 4);
  assert.equal(result.length, 2);
  assert.equal(result[0].start, 0);
  assert.equal(result.at(-1).end, 4);
  assert.equal(result[0].end, result[1].start);
  assert.deepEqual(result.map(item => item.text), ['第一句话。', '第二句话！']);
});

test('高静音概率的低置信度结果不会生成幻觉字幕', () => {
  const result = normalizeTranscriptionSegments([
    { start: 0, end: 3, text: '感谢观看', no_speech_prob: 0.95, avg_logprob: -1.5 },
  ], 3);
  assert.deepEqual(result, []);
});

test('没有 segment 时可以使用完整识别文本兜底', () => {
  assert.deepEqual(normalizeTranscriptionSegments([], 2, '你好'), [
    { id: 'subtitle-1', text: '你好', start: 0, end: 2 },
  ]);
});

test('只把 Remotion 本地页面无响应识别为可安全重试错误', () => {
  assert.equal(isTransientRemotionServerError(new Error('Visited "http://localhost:3100/index.html" but got no response.')), true);
  assert.equal(isTransientRemotionServerError(new Error('渲染编码失败')), false);
});
