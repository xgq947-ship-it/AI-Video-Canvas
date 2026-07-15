/**
 * shared/manifest.d.ts —— 统一项目清单 TypeScript 类型（供前端与 Remotion 合成使用）。
 * 运行时实现见 shared/manifest.js。
 */

export interface CompositionConfig {
  width: number;
  height: number;
  fps: number;
}

/** 视频镜头：start/end 是「源素材」裁剪入点/出点（秒），按 order 顺序硬切拼接。 */
export interface Shot {
  id: string;
  name?: string;
  file: string;
  start: number;
  end: number;
  volume?: number;
  order?: number;
}

export type AudioTrackType = 'dialogue' | 'sfx' | 'bgm';

/** 音轨：start/end 是「成片时间轴」上的绝对位置（秒）。 */
export interface AudioTrack {
  id: string;
  type: AudioTrackType;
  file: string;
  start: number;
  end: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** 仅对 bgm 有意义：对白期间自动压低音量 */
  ducking?: boolean;
  loop?: boolean;
  speaker?: string;
}

/** 字幕：start/end 是「成片时间轴」上的绝对位置（秒）。 */
export interface Subtitle {
  id: string;
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface OutputConfig {
  endFadeToBlack?: number;
  subtitleStyle?: string;
  fileName?: string;
}

export interface ProjectMeta {
  id: string;
  title: string;
}

export interface ProjectManifest {
  project: ProjectMeta;
  composition: CompositionConfig;
  shots: Shot[];
  audioTracks: AudioTrack[];
  subtitles: Subtitle[];
  output?: OutputConfig;
}

export interface ShotLayout {
  shot: Shot;
  index: number;
  fromSec: number;
  trimBeforeSec: number;
  durationSec: number;
}

export interface AssetRef {
  kind: 'shot' | 'audio';
  id: string;
  raw: string;
  path: string;
}

export function secToFrames(sec: number, fps: number): number;
export function normalizeAssetPath(file: string): string;
export function layoutShots(shots: Shot[]): ShotLayout[];
export function computeShotsDurationSec(shots: Shot[]): number;
export function computeTotalDurationSec(manifest: ProjectManifest): number;
export function getDialogueWindows(manifest: ProjectManifest): { start: number; end: number }[];
export function createEmptyManifest(): ProjectManifest;
export function validateManifestShape(manifest: unknown): { valid: boolean; errors: string[] };
export function collectAssetRefs(manifest: ProjectManifest): AssetRef[];
export const AUDIO_TRACK_TYPES: AudioTrackType[];
