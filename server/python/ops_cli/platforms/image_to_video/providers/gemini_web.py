from __future__ import annotations

from pathlib import Path

from ops_cli.output import CommandResponse
from ops_cli.platforms._gemini_web_common import (
    MAX_VIDEO_REFERENCES,
    VIDEO_ASPECT_RATIOS,
    VIDEO_DURATIONS,
    GeminiWebError,
    build_video_prompt,
    run_media_generation,
)


def run_video_generate(
    *, prompt: str, reference_images: list[str] | None = None, duration: int = 8,
    aspect_ratio: str = "16:9", output_dir: str | None = None, timeout_minutes: int = 15,
    camera_movement: str = "", native_audio: bool = True,
    dry_run: bool = False, execute: bool = False,
) -> CommandResponse:
    normalized = str(prompt or "").strip()
    references = list(reference_images or [])
    if not normalized:
        raise GeminiWebError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空")
    if aspect_ratio not in VIDEO_ASPECT_RATIOS:
        raise GeminiWebError("ASPECT_RATIO_NOT_SUPPORTED", f"Gemini Web 视频不支持比例 {aspect_ratio}")
    if duration not in VIDEO_DURATIONS:
        raise GeminiWebError("DURATION_NOT_SUPPORTED", "Gemini Web 当前只提供 8 秒视频")
    if len(references) > MAX_VIDEO_REFERENCES:
        raise GeminiWebError("REFERENCE_LIMIT_EXCEEDED", f"Gemini Web 视频最多支持 {MAX_VIDEO_REFERENCES} 张参考图")
    resolved_output = Path(output_dir).expanduser().resolve() if output_dir else Path.home() / "Desktop" / "GeminiWeb视频"
    data = {
        "prompt": normalized,
        "submitted_prompt": build_video_prompt(normalized, aspect_ratio, duration, len(references), camera_movement=camera_movement, native_audio=native_audio),
        "reference_images": references,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "native_audio": native_audio,
        "output_dir": str(resolved_output),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "scene": "gemini_web/video_generate",
    }
    if dry_run or not execute:
        return CommandResponse(success=True, platform="gemini_web", command="image-to-video generate", data=data)
    video_path, video_url = run_media_generation(
        kind="video", prompt=normalized, aspect_ratio=aspect_ratio, duration=duration,
        reference_images=references, output_dir=str(resolved_output), timeout_minutes=timeout_minutes,
        camera_movement=camera_movement, native_audio=native_audio,
    )
    data.update({"video_path": video_path, "video_url": video_url, "artifacts": [video_path], "source": "page"})
    return CommandResponse(success=True, platform="gemini_web", command="image-to-video generate", data=data)
