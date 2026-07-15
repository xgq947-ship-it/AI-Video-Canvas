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
import type { ProjectManifest, AudioTrack, Subtitle } from "../shared/manifest";
import {
  layoutShots,
  normalizeAssetPath,
  getDialogueWindows,
} from "../shared/manifest.js";

/**
 * 通用漫剧成片合成 —— 完全由 project-manifest 驱动，无任何单片硬编码。
 *
 * 画面：镜头按 order 顺序首尾硬切拼接，objectFit: cover（等比铺满不拉伸）。
 * 声音：dialogue / sfx / bgm 三类音轨按绝对时间轴摆放，支持淡入淡出、循环、
 *       以及 bgm 在对白期间自动闪避(ducking)。
 * 字幕：按绝对时间轴摆放，通用中文样式。
 * 收尾：可选结尾淡黑。
 */

export type MangaProps = {
  manifest: ProjectManifest;
};

const DUCK_FACTOR = 0.4; // 对白期间 BGM 压低到 40%

const VideoTrack: React.FC<{ manifest: ProjectManifest }> = ({ manifest }) => {
  const { fps } = useVideoConfig();
  const secToFrames = (s: number) => Math.round(s * fps);
  return (
    <>
      {layoutShots(manifest.shots).map((L) => (
        <Sequence
          key={L.shot.id || L.index}
          from={secToFrames(L.fromSec)}
          durationInFrames={Math.max(1, secToFrames(L.durationSec))}
        >
          <OffthreadVideo
            src={staticFile(normalizeAssetPath(L.shot.file))}
            trimBefore={secToFrames(L.trimBeforeSec)}
            volume={L.shot.volume && L.shot.volume > 0 ? L.shot.volume : 0}
            muted={!L.shot.volume || L.shot.volume <= 0}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Sequence>
      ))}
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

const SubtitleView: React.FC<{ text: string; durationInFrames: number }> = ({
  text,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 4, Math.max(4, durationInFrames - 4), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 48,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          color: "#f5f5f5",
          fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: 1.5,
          lineHeight: 1.3,
          textShadow: "0 2px 5px rgba(0,0,0,0.95), 0 0 2px #000",
          opacity,
          maxWidth: "86%",
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
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

      {(manifest.subtitles || []).map((sub: Subtitle) => {
        const from = secToFrames(sub.start);
        const dur = Math.max(1, secToFrames(sub.end) - from);
        return (
          <Sequence key={sub.id} from={from} durationInFrames={dur}>
            <SubtitleView text={sub.text} durationInFrames={dur} />
          </Sequence>
        );
      })}

      {endFade > 0 && (
        <AbsoluteFill style={{ backgroundColor: "black", opacity: finalFade }} />
      )}
    </AbsoluteFill>
  );
};
