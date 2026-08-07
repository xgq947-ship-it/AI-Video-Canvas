const TERMINAL_PUNCTUATION = /([，。！？；：、,.!?;:])/g;
const SENTENCE_END = /[。！？.!?][”’"']?$/;
const CLAUSE_END = /[，；：、,;:][”’"']?$/;
const ALLOWED_AI_PUNCTUATION = new Set(['', '，', '。', '！', '？', '；', '：']);

const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * 把一段识别文本切成适合短视频展示的小段。中文按字符计数，英文单词也会被保留，
 * 每一小段按字符权重继承原 ASR 时间窗，保证不越过源视频时长。
 */
export const splitSubtitleText = (text, maxChars = 14) => {
  const normalized = cleanText(text);
  if (!normalized) return [];
  const clauses = normalized
    .replace(TERMINAL_PUNCTUATION, '$1\n')
    .split('\n')
    .map(cleanText)
    .filter(Boolean);
  const result = [];
  for (const clause of clauses.length ? clauses : [normalized]) {
    let rest = clause;
    while (rest.length > maxChars) {
      let cut = maxChars;
      const whitespace = rest.lastIndexOf(' ', maxChars);
      if (whitespace >= Math.floor(maxChars * 0.55)) cut = whitespace + 1;
      result.push(cleanText(rest.slice(0, cut)));
      rest = cleanText(rest.slice(cut));
    }
    if (rest) result.push(rest);
  }
  return result;
};

/**
 * 规范 OpenAI Whisper 的 segment 响应为 Evan 使用的稳定字幕时间轴。
 */
export const normalizeTranscriptionSegments = (segments, durationSec, fallbackText = '') => {
  const duration = Math.max(0, Number(durationSec) || 0);
  const source = Array.isArray(segments) ? segments : [];
  const usable = source.filter((segment) => {
    if (!cleanText(segment?.text)) return false;
    const noSpeech = Number(segment?.no_speech_prob);
    const confidence = Number(segment?.avg_logprob);
    return !(Number.isFinite(noSpeech) && noSpeech >= 0.8 && Number.isFinite(confidence) && confidence < -1);
  });
  const normalizedSource = usable.length > 0
    ? usable
    : cleanText(fallbackText) && duration > 0
      ? [{ start: 0, end: duration, text: fallbackText }]
      : [];

  const output = [];
  for (const segment of normalizedSource) {
    const start = Math.max(0, Math.min(duration, Number(segment.start) || 0));
    const rawEnd = Number(segment.end);
    const end = Math.max(start, Math.min(duration, Number.isFinite(rawEnd) ? rawEnd : duration));
    if (end - start < 0.08) continue;
    const chunks = splitSubtitleText(segment.text);
    if (chunks.length === 0) continue;
    const totalWeight = chunks.reduce((sum, chunk) => sum + Math.max(1, chunk.replace(/\s/g, '').length), 0);
    let cursor = start;
    chunks.forEach((text, index) => {
      const weight = Math.max(1, text.replace(/\s/g, '').length);
      const chunkEnd = index === chunks.length - 1
        ? end
        : Math.min(end, cursor + ((end - start) * weight) / totalWeight);
      if (chunkEnd - cursor >= 0.08) {
        output.push({
          id: `subtitle-${output.length + 1}`,
          text,
          start: Math.round(cursor * 1000) / 1000,
          end: Math.round(chunkEnd * 1000) / 1000,
        });
      }
      cursor = chunkEnd;
    });
  }
  return output;
};

const subtitleTextLength = (value) => Array.from(cleanText(value).replace(/\s/g, '')).length;

const joinTimedWordText = (parts) => parts.reduce((output, part) => {
  const text = cleanText(part);
  if (!text) return output;
  if (!output) return text;
  const needsSpace = /[A-Za-z0-9]$/.test(output) && /^[A-Za-z0-9]/.test(text);
  return `${output}${needsSpace ? ' ' : ''}${text}`;
}, '');

/**
 * 规范词级时间戳。这里不按字符数重估时间，只裁掉越界数据并保持原始语音边界。
 */
export const normalizeTimedWords = (words, durationSec) => {
  const duration = Math.max(0, Number(durationSec) || 0);
  if (!Array.isArray(words) || duration <= 0) return [];
  return words
    .map((word, index) => {
      const text = cleanText(word?.word ?? word?.text);
      const rawStart = Number(word?.start);
      const rawEnd = Number(word?.end);
      if (!text || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;
      const start = Math.max(0, Math.min(duration, rawStart));
      const end = Math.max(start, Math.min(duration, rawEnd));
      if (end - start < 0.01) return null;
      return { index, text, start, end };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
    .map(({ index: _index, ...word }) => word);
};

const finalizeAlignedCues = (cues, durationSec) => cues
  .map((cue, index) => {
    const nextStart = cues[index + 1]?.start;
    const end = Number.isFinite(nextStart) && cue.end > nextStart ? nextStart : cue.end;
    return {
      id: `subtitle-${index + 1}`,
      text: cleanText(cue.text),
      start: Math.round(cue.start * 1000) / 1000,
      end: Math.round(Math.min(Number(durationSec) || cue.end, end) * 1000) / 1000,
    };
  })
  .filter(cue => cue.text && cue.end - cue.start >= 0.01);

/**
 * 从词级时间戳生成字幕。断句只选择“在哪个词后结束”，每条字幕始终使用首词 start
 * 和末词 end，因此语速变化、停顿和长短句都不会再造成按字数平均分配的漂移。
 */
export const buildAlignedSubtitles = (words, durationSec, options = {}) => {
  const normalized = normalizeTimedWords(words, durationSec);
  if (normalized.length === 0) return [];
  const maxChars = Math.max(4, Number(options.maxChars) || 14);
  const maxDurationSec = Math.max(0.8, Number(options.maxDurationSec) || 4.2);
  const maxGapSec = Math.max(0.08, Number(options.maxGapSec) || 0.55);
  const cues = [];
  let group = [];

  const flush = () => {
    if (group.length === 0) return;
    cues.push({
      text: joinTimedWordText(group.map(word => word.text)),
      start: group[0].start,
      end: group.at(-1).end,
    });
    group = [];
  };

  normalized.forEach((word, index) => {
    const candidate = joinTimedWordText([...group.map(item => item.text), word.text]);
    if (group.length > 0 && subtitleTextLength(candidate) > maxChars) flush();
    group.push(word);
    const next = normalized[index + 1];
    const text = joinTimedWordText(group.map(item => item.text));
    const duration = group.at(-1).end - group[0].start;
    const gap = next ? next.start - group.at(-1).end : 0;
    if (
      SENTENCE_END.test(text)
      || (CLAUSE_END.test(text) && subtitleTextLength(text) >= Math.ceil(maxChars * 0.45))
      || duration >= maxDurationSec
      || gap >= maxGapSec
    ) flush();
  });
  flush();
  return finalizeAlignedCues(cues, durationSec);
};

/**
 * 应用 AI 给出的断句点。AI 只能返回词下标和句末标点，不能改识别文本或时间戳。
 * 任一断句越界、倒序或过长就拒绝整份计划，调用方应回退 buildAlignedSubtitles。
 */
export const buildAlignedSubtitlesFromBreakPlan = (words, durationSec, breakPlan, options = {}) => {
  const normalized = normalizeTimedWords(words, durationSec);
  if (normalized.length === 0 || !Array.isArray(breakPlan) || breakPlan.length === 0) return [];
  const maxChars = Math.max(4, Number(options.maxChars) || 16);
  const maxDurationSec = Math.max(1, Number(options.maxDurationSec) || 5.2);
  const plan = breakPlan.map(item => ({
    endWord: Number(item?.endWord),
    punctuation: String(item?.punctuation || ''),
  }));
  if (plan.at(-1)?.endWord !== normalized.length - 1) {
    plan.push({ endWord: normalized.length - 1, punctuation: '。' });
  }

  const cues = [];
  let startWord = 0;
  for (const item of plan) {
    if (!Number.isInteger(item.endWord) || item.endWord < startWord || item.endWord >= normalized.length) return [];
    if (!ALLOWED_AI_PUNCTUATION.has(item.punctuation)) return [];
    const group = normalized.slice(startWord, item.endWord + 1);
    let text = joinTimedWordText(group.map(word => word.text));
    if (item.punctuation && !TERMINAL_PUNCTUATION.test(text.at(-1) || '')) text += item.punctuation;
    TERMINAL_PUNCTUATION.lastIndex = 0;
    if (subtitleTextLength(text) > maxChars || group.at(-1).end - group[0].start > maxDurationSec) return [];
    cues.push({ text, start: group[0].start, end: group.at(-1).end });
    startWord = item.endWord + 1;
  }
  if (startWord !== normalized.length) return [];
  return finalizeAlignedCues(cues, durationSec);
};

export const formatAssTimestamp = (seconds) => {
  const centiseconds = Math.max(0, Math.round((Number(seconds) || 0) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const escapeAssText = (value) => String(value || '')
  .replace(/\\/g, '／')
  .replace(/[{}]/g, '')
  .replace(/\r?\n/g, '\\N');

/** 生成可由内置 FFmpeg/libass 直接烧录的 ASS 文档。 */
export const generateAssDocument = (subtitles, { width, height } = {}) => {
  const playResX = Math.max(320, Math.round(Number(width) || 1080));
  const playResY = Math.max(240, Math.round(Number(height) || 1920));
  const fontSize = Math.max(28, Math.min(72, Math.round(playResY * 0.042)));
  const marginV = Math.max(28, Math.round(playResY * 0.07));
  const events = (Array.isArray(subtitles) ? subtitles : [])
    .filter(item => cleanText(item?.text) && Number(item?.end) > Number(item?.start))
    .map(item => `Dialogue: 0,${formatAssTimestamp(item.start)},${formatAssTimestamp(item.end)},Default,,0,0,0,,${escapeAssText(item.text)}`)
    .join('\n');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&HCC000000,&H78000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    events,
    '',
  ].join('\n');
};

export const isTransientRemotionServerError = (error) =>
  /Visited "http:\/\/localhost:\d+\/index\.html" but got no response/i.test(String(error?.message || error || ''));
