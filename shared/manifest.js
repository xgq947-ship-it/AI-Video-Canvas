/**
 * shared/manifest.js
 *
 * AI 漫剧统一项目清单（project-manifest）的纯函数核心。
 * 无任何 fs / 浏览器依赖，可被前端(TS)、Remotion 合成(TSX)、服务端(JS) 与测试共同引用。
 *
 * 时间约定（重要）：
 *  - shots[].start / shots[].end   —— 源素材的裁剪入点/出点（秒），镜头按 order 顺序首尾拼接。
 *  - audioTracks[].start / end     —— 成片时间轴上的绝对位置（秒）。
 *  - subtitles[].start / end       —— 成片时间轴上的绝对位置（秒）。
 * 所有时间统一用秒；Remotion 内部按 fps 折算为帧。
 */

/** @param {number} sec @param {number} fps */
export const secToFrames = (sec, fps) => Math.round((Number(sec) || 0) * fps);

/**
 * 把前端存储的素材地址归一化为 Remotion staticFile 可用的相对路径。
 * 例如 "/library/videos/a.mp4" -> "videos/a.mp4"，反斜杠转正斜杠，去掉开头斜杠。
 * 纯字符串处理，不触碰文件系统（穿越校验在服务端做）。
 * @param {string} file
 * @returns {string}
 */
export const normalizeAssetPath = (file) => {
  if (!file || typeof file !== 'string') return '';
  let p = file.trim().replace(/\\/g, '/');
  // 去掉查询串（?t=123 缓存串）
  p = p.split('?')[0].split('#')[0];
  // 去掉 http(s)://host 前缀，只保留 /library/... 之后的路径
  const libIdx = p.indexOf('/library/');
  if (libIdx >= 0) p = p.slice(libIdx + '/library/'.length);
  else if (p.startsWith('library/')) p = p.slice('library/'.length);
  // 去掉任何残留的开头斜杠
  p = p.replace(/^\/+/, '');
  // 资产 URL 里的路径段是百分号编码的（中文/空格项目名等），磁盘查找需要解码后的真实名称。
  if (p.includes('%')) {
    try {
      p = decodeURIComponent(p);
    } catch {
      // 保留原始字符串：极少数情况下含有非法转义序列，交给上层按原样匹配。
    }
  }
  return p;
};

/**
 * 按 order 排序镜头，计算每个镜头的裁剪与时长（秒），并给出累计入点（秒）。
 * @param {Array} shots
 * @returns {Array<{shot:any, index:number, fromSec:number, trimBeforeSec:number, durationSec:number}>}
 */
export const layoutShots = (shots) => {
  const list = Array.isArray(shots) ? shots.slice() : [];
  list.sort((a, b) => {
    const ao = a && a.order != null ? a.order : 0;
    const bo = b && b.order != null ? b.order : 0;
    return ao - bo;
  });
  let cursor = 0;
  return list.map((shot, index) => {
    const start = Number(shot.start) || 0;
    const end = shot.end != null ? Number(shot.end) : start;
    const durationSec = Math.max(0, end - start);
    const fromSec = cursor;
    cursor += durationSec;
    return { shot, index, fromSec, trimBeforeSec: start, durationSec };
  });
};

/** 视频镜头拼接后的总时长（秒） */
export const computeShotsDurationSec = (shots) =>
  layoutShots(shots).reduce((sum, s) => sum + s.durationSec, 0);

/**
 * 成片总时长（秒）= max(镜头总时长, 所有音轨结束点, 所有字幕结束点)。
 * 保证末尾的音效/BGM/字幕不会被截断。
 * @param {any} manifest
 */
export const computeTotalDurationSec = (manifest) => {
  const shotsDur = computeShotsDurationSec(manifest && manifest.shots);
  const audioEnd = (manifest && Array.isArray(manifest.audioTracks) ? manifest.audioTracks : [])
    .reduce((mx, t) => Math.max(mx, Number(t.end) || 0), 0);
  const subEnd = (manifest && Array.isArray(manifest.subtitles) ? manifest.subtitles : [])
    .reduce((mx, s) => Math.max(mx, Number(s.end) || 0), 0);
  return Math.max(shotsDur, audioEnd, subEnd);
};

/** 对白时间窗（绝对秒），用于 BGM 自动闪避(ducking) */
export const getDialogueWindows = (manifest) =>
  (manifest && Array.isArray(manifest.audioTracks) ? manifest.audioTracks : [])
    .filter((t) => t && t.type === 'dialogue')
    .map((t) => ({ start: Number(t.start) || 0, end: Number(t.end) || 0 }));

/** 空清单模板 */
export const createEmptyManifest = () => ({
  project: { id: '', title: '未命名项目' },
  composition: { width: 1280, height: 720, fps: 24 },
  shots: [],
  audioTracks: [],
  subtitles: [],
  output: { endFadeToBlack: 0.6, subtitleStyle: 'default' },
});

const AUDIO_TYPES = ['dialogue', 'sfx', 'bgm'];

/**
 * 纯结构校验（不检查文件是否存在，那是服务端 fs 的职责）。
 * @param {any} manifest
 * @returns {{valid:boolean, errors:string[]}}
 */
export const validateManifestShape = (manifest) => {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest 不是对象'] };
  }
  const c = manifest.composition;
  if (!c || !(c.width > 0) || !(c.height > 0) || !(c.fps > 0)) {
    errors.push('composition.width/height/fps 必须为正数');
  }
  if (!Array.isArray(manifest.shots)) errors.push('shots 必须为数组');
  else {
    manifest.shots.forEach((s, i) => {
      if (!s || typeof s.file !== 'string' || !s.file.trim()) errors.push(`shots[${i}].file 缺失`);
      const start = Number(s.start) || 0;
      const end = s.end != null ? Number(s.end) : start;
      if (end <= start) errors.push(`shots[${i}] 的 end 必须大于 start`);
      if (s && s.transition != null && !['hard_cut', 'fade'].includes(s.transition)) {
        errors.push(`shots[${i}].transition 非法(应为 hard_cut|fade)`);
      }
    });
  }
  if (manifest.audioTracks != null && !Array.isArray(manifest.audioTracks)) {
    errors.push('audioTracks 必须为数组');
  } else {
    (manifest.audioTracks || []).forEach((t, i) => {
      if (!t || typeof t.file !== 'string' || !t.file.trim()) errors.push(`audioTracks[${i}].file 缺失`);
      if (t && t.type && !AUDIO_TYPES.includes(t.type)) errors.push(`audioTracks[${i}].type 非法(应为 dialogue|sfx|bgm)`);
      const end = Number(t && t.end) || 0;
      const start = Number(t && t.start) || 0;
      if (end <= start) errors.push(`audioTracks[${i}] 的 end 必须大于 start`);
    });
  }
  if (manifest.subtitles != null && !Array.isArray(manifest.subtitles)) {
    errors.push('subtitles 必须为数组');
  } else {
    (manifest.subtitles || []).forEach((s, i) => {
      if (!s || typeof s.text !== 'string') errors.push(`subtitles[${i}].text 缺失`);
      const end = Number(s && s.end) || 0;
      const start = Number(s && s.start) || 0;
      if (end <= start) errors.push(`subtitles[${i}] 的 end 必须大于 start`);
    });
  }
  if (manifest.shots && manifest.shots.length === 0 &&
      (!manifest.audioTracks || manifest.audioTracks.length === 0)) {
    errors.push('清单为空：至少需要一个镜头或一条音轨');
  }
  return { valid: errors.length === 0, errors };
};

/** 收集清单里引用的全部素材相对路径（归一化后），用于素材存在性检查 */
export const collectAssetRefs = (manifest) => {
  const refs = [];
  (manifest && manifest.shots || []).forEach((s) => {
    if (s && s.file) refs.push({ kind: 'shot', id: s.id || s.name || '', raw: s.file, path: normalizeAssetPath(s.file) });
  });
  (manifest && manifest.audioTracks || []).forEach((t) => {
    if (t && t.file) refs.push({ kind: 'audio', id: t.id || '', raw: t.file, path: normalizeAssetPath(t.file) });
  });
  return refs;
};

export const AUDIO_TRACK_TYPES = AUDIO_TYPES;

// 画布节点类型字符串常量（与 src/types.ts 的 NodeType 枚举取值保持一致）
export const MANGA_NODE_TYPES = {
  VIDEO: 'Video',
  AUDIO: 'Audio',        // 配音 / dialogue
  SFX: 'SFX',            // 音效
  BGM: 'BGM',            // 背景音乐
  SUBTITLE: 'Subtitle',  // 字幕
  RENDER: 'Render',      // Remotion 成片
};

const num = (v, d) => (v == null || Number.isNaN(Number(v)) ? d : Number(v));

/**
 * 从画布节点图，围绕某个「成片(Render)」节点，构建统一项目清单。
 * 语义：成片节点的直接父节点（parentIds）按类型分桶：
 *   - Video（有素材）  -> shots（源裁剪点 start/end，按 order/x 排序）
 *   - Audio / SFX / BGM               -> audioTracks（时间轴绝对 start/end）
 *   - Subtitle                        -> subtitles（时间轴绝对 start/end）
 * 纯函数，节点用鸭子类型读取字段，便于测试。
 *
 * @param {string} renderNodeId
 * @param {Array<any>} nodes
 * @param {object} [opts] { project, composition, output }
 * @returns {import('./manifest').ProjectManifest}
 */
export const buildManifestFromNodes = (renderNodeId, nodes, opts = {}) => {
  const T = MANGA_NODE_TYPES;
  const list = Array.isArray(nodes) ? nodes : [];
  const renderNode = list.find((n) => n && n.id === renderNodeId) || {};
  const parentIds = renderNode.parentIds || [];
  const parents = list.filter((n) => n && parentIds.includes(n.id));

  const manifest = createEmptyManifest();
  manifest.project = {
    id: (opts.project && opts.project.id) || renderNode.id || 'project',
    title: (opts.project && opts.project.title) || renderNode.title || '未命名项目',
  };
  manifest.composition = {
    width: num(opts.composition && opts.composition.width, num(renderNode.compWidth, 1280)),
    height: num(opts.composition && opts.composition.height, num(renderNode.compHeight, 720)),
    fps: num(opts.composition && opts.composition.fps, num(renderNode.compFps, 24)),
  };
  manifest.output = {
    endFadeToBlack: num(renderNode.endFadeToBlack, 0.6),
    subtitleStyle: 'default',
  };

  // 镜头
  const shotNodes = parents.filter(
    (n) => n.type === T.VIDEO && (n.resultUrl || n.mediaUrl)
  );
  shotNodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => {
      const ao = a.n.order != null ? a.n.order : null;
      const bo = b.n.order != null ? b.n.order : null;
      if (ao != null && bo != null) return ao - bo;
      if (ao != null) return -1;
      if (bo != null) return 1;
      return num(a.n.x, 0) - num(b.n.x, 0); // 回退：按画布从左到右
    })
    .forEach(({ n }, idx) => {
      const start = num(n.trimStart, 0);
      const end = num(n.trimEnd, num(n.videoDuration, start + 5));
      manifest.shots.push({
        id: n.id,
        name: n.title || `镜头${idx + 1}`,
        file: n.resultUrl || n.mediaUrl,
        start,
        end: end > start ? end : start + 5,
        volume: num(n.shotVolume, 0),
        order: idx + 1,
        transition: n.transition === 'fade' ? 'fade' : 'hard_cut',
      });
    });

  // 音轨
  const audioTypeMap = { [T.AUDIO]: 'dialogue', [T.SFX]: 'sfx', [T.BGM]: 'bgm' };
  parents
    .filter((n) => audioTypeMap[n.type] && (n.mediaUrl || n.resultUrl))
    .forEach((n) => {
      const type = audioTypeMap[n.type];
      const start = num(n.timelineStart, 0);
      const dur = num(n.durationSec, 3);
      const end = num(n.timelineEnd, start + dur);
      manifest.audioTracks.push({
        id: n.id,
        type,
        file: n.mediaUrl || n.resultUrl,
        start,
        end: end > start ? end : start + dur,
        volume: num(n.audioVolume, type === 'bgm' ? 0.15 : 1),
        fadeIn: num(n.fadeIn, type === 'bgm' ? 1 : 0),
        fadeOut: num(n.fadeOut, type === 'bgm' ? 1 : 0),
        ducking: type === 'bgm' ? n.ducking !== false : false,
        loop: !!n.loop,
        speaker: n.speaker || '',
      });
    });

  // 字幕
  parents
    .filter((n) => n.type === T.SUBTITLE && (n.subtitleText || n.prompt))
    .forEach((n) => {
      const start = num(n.timelineStart, 0);
      const end = num(n.timelineEnd, start + 3);
      manifest.subtitles.push({
        id: n.id,
        text: n.subtitleText || n.prompt || '',
        start,
        end: end > start ? end : start + 3,
        speaker: n.speaker || '',
      });
    });

  return manifest;
};
