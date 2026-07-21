"""Image-to-video capability registration.

顶层命名空间是「能力」(image-to-video)，与 tmcs / jst 同级；其下挂多个模型
provider（google-flow / 后续模型）。每个 provider 的 CapabilitySpec.platform 仍是
provider 自身（登录/恢复身份键），而非能力名——见 docs/media_generation_capabilities.md。
"""

from __future__ import annotations

import typer

from ops_cli.capabilities import CapabilitySpec
from ops_cli.cli_helpers import _execute
from ops_cli.platforms.image_to_video.providers.google_flow import run_video_generate
from ops_cli.platforms.image_to_video.providers.jimeng import (
    DEFAULT_MODEL as JIMENG_DEFAULT_MODEL,
)
from ops_cli.platforms.image_to_video.providers.jimeng import (
    run_video_generate as run_jimeng_video_generate,
)


def register(app: typer.Typer, capabilities: dict[str, CapabilitySpec]) -> None:
    image_to_video_app = typer.Typer(
        help="Image-to-video generation (multiple model providers).", no_args_is_help=True
    )
    google_flow_app = typer.Typer(help="Google Flow image-to-video.", no_args_is_help=True)

    @google_flow_app.command("generate")
    def google_flow_generate(
        ctx: typer.Context,
        prompt: str = typer.Option(..., "--prompt", help="Video generation prompt."),
        first_frame: str = typer.Option(
            "", "--first-frame", help="First-frame image path (Frames mode). Omit when using --reference-image."
        ),
        reference_image: list[str] = typer.Option(
            [], "--reference-image", help="Ingredients reference image path(s); repeatable. Triggers Ingredients mode."
        ),
        duration: int = typer.Option(10, "--duration", help="Duration: 4, 6, 8, or 10 seconds."),
        aspect_ratio: str = typer.Option("9:16", "--aspect-ratio", help="Aspect ratio: 9:16 or 16:9."),
        model: str = typer.Option("Omni Flash", "--model", help="Google Flow video model."),
        output_dir: str | None = typer.Option(None, "--output-dir", help="Video and screenshot output directory."),
        timeout_minutes: int = typer.Option(15, "--timeout-minutes", help="Generation timeout in minutes."),
        dry_run: bool = typer.Option(False, "--dry-run", help="Preview only; do not open Flow or consume credits."),
        execute: bool = typer.Option(False, "--execute", help="Actually upload the image and generate a video."),
    ) -> None:
        params = {
            "prompt": prompt,
            "first_frame": first_frame,
            "reference_images": list(reference_image),
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "model": model,
            "output_dir": output_dir,
            "timeout_minutes": timeout_minutes,
            "dry_run": dry_run,
            "execute": execute,
        }
        _execute(
            ctx,
            # command_name 的第 2 段必须等于 CapabilitySpec.platform（登录身份 = provider），
            # 它只用于 (platform, command) 查表与日志，与真实 CLI 路径解耦。
            command_name="ops google_flow image-to-video generate",
            params=params,
            handler=lambda: run_video_generate(**params),
        )

    jimeng_app = typer.Typer(help="即梦 Seedance image/text-to-video.", no_args_is_help=True)

    @jimeng_app.command("generate")
    def jimeng_generate(
        ctx: typer.Context,
        prompt: str = typer.Option(..., "--prompt", help="Video generation prompt."),
        reference_image: list[str] = typer.Option(
            [], "--reference-image", help="Reference material path(s); repeatable, up to 12. Optional."
        ),
        reference_name: list[str] = typer.Option(
            [],
            "--reference-name",
            help="Name shown for each reference on the page (index-aligned with --reference-image). "
            "Defaults to 图片1/图片2/…; the prompt must @ this exact name.",
        ),
        duration: int = typer.Option(5, "--duration", help="Duration in seconds (1-15; model dependent)."),
        aspect_ratio: str = typer.Option("16:9", "--aspect-ratio", help="21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16."),
        resolution: str = typer.Option("720P", "--resolution", help="720P / 1080P / 4K."),
        count: int = typer.Option(1, "--count", help="Number of videos (1-4; VIP models only for >1)."),
        model: str = typer.Option(JIMENG_DEFAULT_MODEL, "--model", help="即梦 video model name."),
        output_dir: str | None = typer.Option(None, "--output-dir", help="Video and screenshot output directory."),
        timeout_minutes: int = typer.Option(15, "--timeout-minutes", help="Generation timeout in minutes."),
        dry_run: bool = typer.Option(False, "--dry-run", help="Preview only; do not open 即梦 or consume credits."),
        execute: bool = typer.Option(False, "--execute", help="Actually submit and generate a video."),
    ) -> None:
        params = {
            "prompt": prompt,
            "reference_images": list(reference_image),
            "reference_names": list(reference_name),
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "count": count,
            "model": model,
            "output_dir": output_dir,
            "timeout_minutes": timeout_minutes,
            "dry_run": dry_run,
            "execute": execute,
        }
        _execute(
            ctx,
            command_name="ops jimeng image-to-video generate",
            params=params,
            handler=lambda: run_jimeng_video_generate(**params),
        )

    image_to_video_app.add_typer(google_flow_app, name="google-flow")
    image_to_video_app.add_typer(jimeng_app, name="jimeng")
    app.add_typer(image_to_video_app, name="image-to-video")

    capabilities["image_to_video.google_flow.generate"] = CapabilitySpec(
        id="image_to_video.google_flow.generate",
        platform="google_flow",
        command="image-to-video generate",
        scenes=("google_flow/video_generate",),
        recovery_policy="interactive_if_tty",
        dry_run_policy="no_browser",
        artifact_types=("video", "png"),
    )

    capabilities["image_to_video.jimeng.generate"] = CapabilitySpec(
        id="image_to_video.jimeng.generate",
        platform="jimeng",
        command="image-to-video generate",
        scenes=("jimeng/video_generate",),
        recovery_policy="interactive_if_tty",
        dry_run_policy="no_browser",
        artifact_types=("video", "png"),
    )
