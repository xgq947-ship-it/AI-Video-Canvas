"""Text-to-image capability registration.

顶层命名空间是「能力」(text-to-image)，与 tmcs / jst 同级；其下挂多个模型 provider
（google-flow / 后续 gemini、gpt 等）。每个 provider 的 CapabilitySpec.platform 仍是
provider 自身（登录/恢复身份键），而非能力名——见 docs/media_generation_capabilities.md。
"""

from __future__ import annotations

import typer

from ops_cli.capabilities import CapabilitySpec
from ops_cli.cli_helpers import _execute
from ops_cli.platforms.text_to_image.providers.google_flow import run_image_generate


def register(app: typer.Typer, capabilities: dict[str, CapabilitySpec]) -> None:
    text_to_image_app = typer.Typer(
        help="Text-to-image generation (multiple model providers).", no_args_is_help=True
    )
    google_flow_app = typer.Typer(help="Google Flow text-to-image (Nano Banana 2).", no_args_is_help=True)

    @google_flow_app.command("generate")
    def google_flow_generate(
        ctx: typer.Context,
        prompt: str = typer.Option(..., "--prompt", help="Image generation prompt."),
        aspect_ratio: str = typer.Option("1:1", "--aspect-ratio", help="Aspect ratio: 16:9 / 4:3 / 1:1 / 3:4 / 9:16."),
        count: int = typer.Option(1, "--count", help="Number of images: 1, 2, 3, or 4."),
        model: str = typer.Option(
            "Nano Banana 2", "--model", help="Model: Nano Banana 2 / Nano Banana Pro / Nano Banana 2 Lite."
        ),
        reference_image: list[str] = typer.Option(
            [], "--reference-image", help="Local reference image path(s); repeatable."
        ),
        output_dir: str | None = typer.Option(None, "--output-dir", help="Image and screenshot output directory."),
        timeout_minutes: int = typer.Option(10, "--timeout-minutes", help="Generation timeout in minutes."),
        dry_run: bool = typer.Option(False, "--dry-run", help="Preview only; do not open Flow or consume credits."),
        execute: bool = typer.Option(False, "--execute", help="Actually generate the image(s)."),
    ) -> None:
        params = {
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "count": count,
            "model": model,
            "reference_images": list(reference_image),
            "output_dir": output_dir,
            "timeout_minutes": timeout_minutes,
            "dry_run": dry_run,
            "execute": execute,
        }
        _execute(
            ctx,
            # command_name 第 2 段必须等于 CapabilitySpec.platform（登录身份 = provider），
            # 仅用于 (platform, command) 查表与日志，与真实 CLI 路径解耦。
            command_name="ops google_flow text-to-image generate",
            params=params,
            handler=lambda: run_image_generate(**params),
        )

    text_to_image_app.add_typer(google_flow_app, name="google-flow")
    app.add_typer(text_to_image_app, name="text-to-image")

    capabilities["text_to_image.google_flow.generate"] = CapabilitySpec(
        id="text_to_image.google_flow.generate",
        platform="google_flow",
        command="text-to-image generate",
        scenes=("google_flow/image_generate",),
        recovery_policy="interactive_if_tty",
        dry_run_policy="no_browser",
        artifact_types=("image", "png"),
    )
