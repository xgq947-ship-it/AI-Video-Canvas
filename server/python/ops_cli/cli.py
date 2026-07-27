"""Ecommerce operations CLI — auto-discovers platform commands."""
from __future__ import annotations

import importlib
import os
from pathlib import Path

import typer

from ops_cli.browser import (
    check_browser_port,
    cleanup_browser_tabs,
    close_browser,
    list_browser_tabs,
    open_browser,
    open_browser_login,
)
from ops_cli.capabilities import CapabilitySpec, register_capabilities
from ops_cli.cli_helpers import _execute
from ops_cli.output import CommandResponse
from ops_cli.platforms._gemini_web_common import run_text_task
from ops_cli.webhttp import (
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    run_web_context,
    run_web_fetch,
)


app = typer.Typer(help="Ecommerce operations CLI.", no_args_is_help=True)


def _discover_and_register_platforms(app: typer.Typer) -> None:
    """Scan platforms/ for platform.py modules and call their register()."""
    platforms_dir = Path(__file__).resolve().parent / "platforms"
    capabilities: dict[str, CapabilitySpec] = {}

    for platform_dir in sorted(platforms_dir.iterdir()):
        if not platform_dir.is_dir() or platform_dir.name.startswith("_"):
            continue
        platform_file = platform_dir / "platform.py"
        if not platform_file.exists():
            continue
        mod = importlib.import_module(f"ops_cli.platforms.{platform_dir.name}.platform")
        mod.register(app, capabilities)

    # Register all collected capabilities with the global registry
    register_capabilities(list(capabilities.values()))


# Browser command (not platform-specific, stays in cli.py)
browser_app = typer.Typer(help="Browser utility commands.", no_args_is_help=True)
DEFAULT_BROWSER_PORT = int(os.environ.get("SESSIONHUB_CDP_PORT", "19222"))


@browser_app.command("check")
def browser_check(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Chrome remote debugging port."),
) -> None:
    _execute(ctx, command_name="ops browser check", params={"port": port}, handler=lambda: check_browser_port(port))


@browser_app.command("tabs")
def browser_tabs(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Chrome remote debugging port."),
) -> None:
    _execute(ctx, command_name="ops browser tabs", params={"port": port}, handler=lambda: list_browser_tabs(port))


@browser_app.command("cleanup")
def browser_cleanup(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Chrome remote debugging port."),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview tabs to close without closing them."),
) -> None:
    _execute(
        ctx,
        command_name="ops browser cleanup",
        params={"port": port, "dry_run": dry_run},
        handler=lambda: cleanup_browser_tabs(port, dry_run=dry_run),
    )


@browser_app.command("login")
def browser_login(
    ctx: typer.Context,
    provider: str = typer.Option(..., "--provider", help="google-flow, jimeng, or gemini-web"),
) -> None:
    _execute(
        ctx,
        command_name="ops browser login",
        params={"provider": provider},
        handler=lambda: open_browser_login(provider),
    )


@browser_app.command("open")
def browser_open(ctx: typer.Context) -> None:
    _execute(
        ctx,
        command_name="ops browser open",
        params={},
        handler=open_browser,
    )


@browser_app.command("close")
def browser_close(ctx: typer.Context) -> None:
    _execute(
        ctx,
        command_name="ops browser close",
        params={},
        handler=close_browser,
    )


@browser_app.command("web-fetch")
def browser_web_fetch(
    ctx: typer.Context,
    provider: str = typer.Option(..., "--provider", help="google-flow, jimeng, or gemini-web"),
    request_file: str = typer.Option(..., "--request-file", help="JSON file holding the request spec(s)."),
    response_file: str = typer.Option(..., "--response-file", help="Where to write the raw responses."),
    timeout_seconds: int = typer.Option(DEFAULT_FETCH_TIMEOUT_SECONDS, "--timeout-seconds"),
) -> None:
    """Run HTTP request(s) from inside the logged-in provider page.

    Headers, cookies and bodies travel through the two files only: `params` and
    the response `data` are written to app.log, so nothing secret may go there.
    """
    params = {
        "provider": provider,
        "request_file": request_file,
        "response_file": response_file,
        "timeout_seconds": timeout_seconds,
    }
    _execute(
        ctx,
        command_name="ops browser web-fetch",
        params=params,
        handler=lambda: run_web_fetch(**params),
    )


@browser_app.command("web-context")
def browser_web_context(
    ctx: typer.Context,
    provider: str = typer.Option(..., "--provider", help="google-flow, jimeng, or gemini-web"),
    output_file: str = typer.Option(..., "--output-file", help="Where to write the auth/bootstrap context."),
) -> None:
    params = {"provider": provider, "output_file": output_file}
    _execute(
        ctx,
        command_name="ops browser web-context",
        params=params,
        handler=lambda: run_web_context(**params),
    )


# Register browser capability
register_capabilities(
    [
        CapabilitySpec(id="browser.check", platform="browser", command="check", recovery_policy="never"),
        CapabilitySpec(id="browser.web-fetch", platform="browser", command="web-fetch", recovery_policy="never"),
        CapabilitySpec(id="browser.web-context", platform="browser", command="web-context", recovery_policy="never"),
        CapabilitySpec(id="browser.tabs", platform="browser", command="tabs", recovery_policy="never"),
        CapabilitySpec(id="browser.cleanup", platform="browser", command="cleanup", recovery_policy="never"),
        CapabilitySpec(id="browser.open", platform="browser", command="open", recovery_policy="never"),
        CapabilitySpec(id="browser.login", platform="browser", command="login", recovery_policy="never"),
        CapabilitySpec(id="browser.close", platform="browser", command="close", recovery_policy="never"),
    ]
)

app.add_typer(browser_app, name="browser")

gemini_web_app = typer.Typer(help="Gemini Apps web text tasks.", no_args_is_help=True)


@gemini_web_app.command("ask")
def gemini_web_ask(
    ctx: typer.Context,
    prompt: str = typer.Option(..., "--prompt"),
    reference_image: list[str] = typer.Option([], "--reference-image"),
    timeout_minutes: int = typer.Option(5, "--timeout-minutes"),
) -> None:
    params = {"prompt": prompt, "reference_images": list(reference_image), "timeout_minutes": timeout_minutes}

    def handler() -> CommandResponse:
        text = run_text_task(**params)
        return CommandResponse(success=True, platform="gemini_web", command="ask", data={"text": text})

    _execute(ctx, command_name="ops gemini_web ask", params=params, handler=handler)


register_capabilities([
    CapabilitySpec(id="gemini_web.ask", platform="gemini_web", command="ask", recovery_policy="interactive_if_tty")
])
app.add_typer(gemini_web_app, name="gemini-web")

# Discover and register all platforms
_discover_and_register_platforms(app)


@app.callback()
def main_callback(
    ctx: typer.Context,
    json_output: bool = typer.Option(False, "--json", help="Output JSON."),
    interactive_login: bool | None = typer.Option(
        None,
        "--interactive-login/--no-interactive-login",
        help="Override terminal detection for SessionHub login recovery.",
    ),
) -> None:
    ctx.obj = {"json_output": json_output, "interactive_login": interactive_login}


def main() -> None:
    app()
