const TERMINAL_PUNCTUATION = /([，。！？；：、,.!?;:])/g;

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

export const isTransientRemotionServerError = (error) =>
  /Visited "http:\/\/localhost:\d+\/index\.html" but got no response/i.test(String(error?.message || error || ''));
