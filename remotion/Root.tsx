import React from "react";
import { Composition } from "remotion";
import { MangaComposition, type MangaProps } from "./MangaComposition";
import { createEmptyManifest, computeTotalDurationSec, secToFrames } from "../shared/manifest.js";

/**
 * 注册通用漫剧合成。宽高/帧率/时长全部由传入的 manifest 通过 calculateMetadata
 * 动态计算 —— 渲染时以 inputProps.manifest 覆盖 defaultProps。
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Manga"
      component={MangaComposition}
      durationInFrames={1}
      fps={24}
      width={1280}
      height={720}
      defaultProps={{ manifest: createEmptyManifest() }}
      calculateMetadata={({ props }: { props: MangaProps }) => {
        const m = props.manifest;
        const fps = (m && m.composition && m.composition.fps) || 24;
        const totalSec = computeTotalDurationSec(m);
        return {
          durationInFrames: Math.max(1, secToFrames(totalSec, fps)),
          fps,
          width: (m && m.composition && m.composition.width) || 1280,
          height: (m && m.composition && m.composition.height) || 720,
        };
      }}
    />
  );
};
