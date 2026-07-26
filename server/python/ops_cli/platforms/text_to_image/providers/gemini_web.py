from __future__ import annotations

from pathlib import Path

from ops_cli.output import CommandResponse
from ops_cli.platforms._gemini_web_common import (
    IMAGE_ASPECT_RATIOS,
    MAX_IMAGE_REFERENCES,
    GeminiWebError,
    build_image_prompt,
    run_media_generation,
)


def run_image_generate(
    *, prompt: str, aspect_ratio: str = "1:1", count: int = 1,
    reference_images: list[str] | None = None, output_dir: str | None = None,
    timeout_minutes: int = 10, dry_run: bool = False, execute: bool = False,
) -> CommandResponse:
    normalized = str(prompt or "").strip()
    references = list(reference_images or [])
    if not normalized:
        raise GeminiWebError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空")
    if aspect_ratio not in IMAGE_ASPECT_RATIOS:
        raise GeminiWebError("ASPECT_RATIO_NOT_SUPPORTED", f"Gemini Web 不支持比例 {aspect_ratio}")
    if count != 1:
        raise GeminiWebError("COUNT_NOT_SUPPORTED", "Gemini Web 网页单次只返回 1 张图片")
    if len(references) > MAX_IMAGE_REFERENCES:
        raise GeminiWebError("REFERENCE_LIMIT_EXCEEDED", f"Gemini Web 最多支持 {MAX_IMAGE_REFERENCES} 张参考图")
    resolved_output = Path(output_dir).expanduser().resolve() if output_dir else Path.home() / "Desktop" / "GeminiWeb生图"
    data = {
        "prompt": normalized,
        "submitted_prompt": build_image_prompt(normalized, aspect_ratio, len(references)),
        "aspect_ratio": aspect_ratio,
        "count": 1,
        "reference_images": references,
        "output_dir": str(resolved_output),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "scene": "gemini_web/image_generate",
    }
    if dry_run or not execute:
        return CommandResponse(success=True, platform="gemini_web", command="text-to-image generate", data=data)
    image_path, image_url = run_media_generation(
        kind="image", prompt=normalized, aspect_ratio=aspect_ratio, reference_images=references,
        output_dir=str(resolved_output), timeout_minutes=timeout_minutes,
    )
    data.update({"images": [{"path": image_path, "url": image_url}], "artifacts": [image_path], "source": "page"})
    return CommandResponse(success=True, platform="gemini_web", command="text-to-image generate", data=data)
