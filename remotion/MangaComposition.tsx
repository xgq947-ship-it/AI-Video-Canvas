import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { ProjectManifest, AudioTrack } from "../shared/manifest";
import {
  layoutShots,
  normalizeAssetPath,
  getDialogueWindows,
} from "../shared/manifest.js";

/**
 * 通用漫剧成片合成 —— 完全由 project-manifest 驱动，无任何单片硬编码。
 *
 * 画面：镜头按 order 顺序拼接，支持 hard_cut 与 fade，objectFit: cover（等比铺满不拉伸）。
 * 声音：dialogue / sfx / bgm 三类音轨按绝对时间轴摆放，支持淡入淡出、循环、
 *       以及 bgm 在对白期间自动闪避(ducking)。
 * 收尾：可选结尾淡黑。
 */

export type MangaProps = {
  manifest: ProjectManifest;
};

const DUCK_FACTOR = 0.4; // 对白期间 BGM 压低到 40%
const FADE_DURATION_SEC = 0.28;

const ShotVideo: React.FC<{
  file: string;
  trimBeforeFrames: number;
  durationInFrames: number;
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
}> = ({
  file,
  trimBeforeFrames,
  durationInFrames,
  volume,
  fadeIn,
  fadeOut,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeFrames = Math.max(
    1,
    Math.min(Math.round(FADE_DURATION_SEC * fps), Math.floor(durationInFrames / 2))
  );
  let opacity = 1;
  if (fadeIn) {
    opacity *= interpolate(frame, [0, fadeFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (fadeOut) {
    opacity *= interpolate(
      frame,
      [Math.max(0, durationInFrames - fadeFrames), durationInFrames],
      [1, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }
    );
  }
  return (
    <OffthreadVideo
      src={staticFile(normalizeAssetPath(file))}
      trimBefore={trimBeforeFrames}
      volume={volume > 0 ? volume : 0}
      muted={volume <= 0}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity,
      }}
    />
  );
};

const VideoTrack: React.FC<{ manifest: ProjectManifest }> = ({ manifest }) => {
  const { fps } = useVideoConfig();
  const secToFrames = (s: number) => Math.round(s * fps);
  const layouts = layoutShots(manifest.shots);
  return (
    <>
      {layouts.map((L) => {
        const durationInFrames = Math.max(1, secToFrames(L.durationSec));
        const previous = L.index > 0 ? layouts[L.index - 1].shot : null;
        return (
          <Sequence
            key={L.shot.id || L.index}
            from={secToFrames(L.fromSec)}
            durationInFrames={durationInFrames}
          >
            <ShotVideo
              file={L.shot.file}
              trimBeforeFrames={secToFrames(L.trimBeforeSec)}
              durationInFrames={durationInFrames}
              volume={L.shot.volume && L.shot.volume > 0 ? L.shot.volume : 0}
              fadeIn={previous?.transition === "fade"}
              fadeOut={L.shot.transition === "fade" && L.index < layouts.length - 1}
            />
          </Sequence>
        );
      })}
    </>
  );
};

const AudioLayer: React.FC<{ track: AudioTrack; manifest: ProjectManifest; fps: number }> = ({
  track,
  manifest,
  fps,
}) => {
  const startFrame = Math.round((Number(track.start) || 0) * fps);
  const durFrames = Math.max(1, Math.round(((Number(track.end) || 0) - (Number(track.start) || 0)) * fps));
  const base = track.volume != null ? track.volume : 1;
  const fadeInF = Math.max(0, Math.round((track.fadeIn || 0) * fps));
  const fadeOutF = Math.max(0, Math.round((track.fadeOut || 0) * fps));
  const dialogueWindows =
    track.type === "bgm" && track.ducking ? getDialogueWindows(manifest) : [];

  const volumeFn = (audioFrame: number) => {
    let v = base;
    if (fadeInF > 0) {
      v *= interpolate(audioFrame, [0, fadeInF], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (fadeOutF > 0) {
      v *= interpolate(audioFrame, [durFrames - fadeOutF, durFrames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (dialogueWindows.length > 0) {
      const absSec = track.start + audioFrame / fps;
      const inDialogue = dialogueWindows.some((w) => absSec >= w.start && absSec <= w.end);
      if (inDialogue) v *= DUCK_FACTOR;
    }
    return Math.max(0, v);
  };

  return (
    <Sequence from={startFrame} durationInFrames={durFrames}>
      <Audio src={staticFile(normalizeAssetPath(track.file))} volume={volumeFn} loop={!!track.loop} />
    </Sequence>
  );
};

export const MangaComposition: React.FC<MangaProps> = ({ manifest }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const secToFrames = (s: number) => Math.round(s * fps);

  const endFade = manifest.output?.endFadeToBlack || 0;
  const finalFade =
    endFade > 0
      ? interpolate(
          frame,
          [durationInFrames - secToFrames(endFade), durationInFrames],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        )
      : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <VideoTrack manifest={manifest} />

      {(manifest.audioTracks || []).map((track) => (
        <AudioLayer key={track.id} track={track} manifest={manifest} fps={fps} />
      ))}

      {endFade > 0 && (
        <AbsoluteFill style={{ backgroundColor: "black", opacity: finalFade }} />
      )}
    </AbsoluteFill>
  );
};
