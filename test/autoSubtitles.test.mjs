import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAlignedSubtitles,
  buildAlignedSubtitlesFromBreakPlan,
  formatAssTimestamp,
  generateAssDocument,
  isTransientRemotionServerError,
  normalizeTimedWords,
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

test('词级时间戳断句保留真实语音边界，不再按字符数平均分配', () => {
  const words = [
    { word: '大家好，', start: 0.18, end: 0.72 },
    { word: '今天', start: 1.36, end: 1.68 },
    { word: '测试', start: 1.7, end: 2.08 },
    { word: '同步。', start: 2.12, end: 2.62 },
  ];
  assert.deepEqual(normalizeTimedWords(words, 3), words.map(({ word, ...timing }) => ({ text: word, ...timing })));
  const result = buildAlignedSubtitles(words, 3);
  assert.deepEqual(result, [
    { id: 'subtitle-1', text: '大家好，', start: 0.18, end: 0.72 },
    { id: 'subtitle-2', text: '今天测试同步。', start: 1.36, end: 2.62 },
  ]);
});

test('AI 断句只能选择词边界，不能改动词级时间轴', () => {
  const words = [
    { word: '这款', start: 0.2, end: 0.52 },
    { word: '按摩仪', start: 0.55, end: 1.12 },
    { word: '使用', start: 1.4, end: 1.78 },
    { word: '很方便', start: 1.8, end: 2.4 },
  ];
  const result = buildAlignedSubtitlesFromBreakPlan(words, 3, [
    { endWord: 1, punctuation: '，' },
    { endWord: 3, punctuation: '。' },
  ]);
  assert.deepEqual(result, [
    { id: 'subtitle-1', text: '这款按摩仪，', start: 0.2, end: 1.12 },
    { id: 'subtitle-2', text: '使用很方便。', start: 1.4, end: 2.4 },
  ]);
  assert.deepEqual(buildAlignedSubtitlesFromBreakPlan(words, 3, [{ endWord: 99, punctuation: '。' }]), []);
});

test('ASS 使用词级字幕时间并生成可烧录样式', () => {
  assert.equal(formatAssTimestamp(61.239), '0:01:01.24');
  const ass = generateAssDocument([
    { text: '声音同步', start: 0.18, end: 1.12 },
  ], { width: 1080, height: 1920 });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 0,0:00:00\.18,0:00:01\.12,Default/);
  assert.match(ass, /声音同步/);
});

test('自动字幕服务请求词级时间戳并通过 ASS + FFmpeg 输出 MP4', () => {
  const service = fs.readFileSync(new URL('../server/services/subtitleVideoJobs.js', import.meta.url), 'utf8');
  assert.match(service, /timestamp_granularities: \['word', 'segment'\]/);
  assert.match(service, /buildAlignedSubtitles\(transcription\.words/);
  assert.match(service, /generateAssDocument\(subtitles, metadata\)/);
  assert.match(service, /'-vf', 'ass=captions\.ass'/);
  assert.match(service, /'-c:v', 'libx264'/);
  assert.match(service, /'-c:a', 'aac'/);
});

test('只把 Remotion 本地页面无响应识别为可安全重试错误', () => {
  assert.equal(isTransientRemotionServerError(new Error('Visited "http://localhost:3100/index.html" but got no response.')), true);
  assert.equal(isTransientRemotionServerError(new Error('渲染编码失败')), false);
});
