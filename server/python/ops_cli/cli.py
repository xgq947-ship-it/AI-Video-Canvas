"""Ecommerce operations CLI — auto-discovers platform commands."""
from __future__ import annotations

import os

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
from ops_cli.webhttp import (
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    run_web_context,
    run_web_fetch,
)


app = typer.Typer(help="Ecommerce operations CLI.", no_args_is_help=True)


# Browser command (not platform-specific, stays in cli.py)
browser_app = typer.Typer(help="Browser utility commands.", no_args_is_help=True)
DEFAULT_BROWSER_PORT = int(os.environ.get("AI_BROWSER_HUB_CDP_PORT", "0"))


@browser_app.command("check")
def browser_check(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Optional Hub CDP port override."),
) -> None:
    _execute(ctx, command_name="ops browser check", params={"port": port}, handler=lambda: check_browser_port(port))


@browser_app.command("tabs")
def browser_tabs(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Optional Hub CDP port override."),
) -> None:
    _execute(ctx, command_name="ops browser tabs", params={"port": port}, handler=lambda: list_browser_tabs(port))


@browser_app.command("cleanup")
def browser_cleanup(
    ctx: typer.Context,
    port: int = typer.Option(DEFAULT_BROWSER_PORT, "--port", help="Optional Hub CDP port override."),
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
    recaptcha_action: str = typer.Option("", "--recaptcha-action", help="Flow generation action; empty for auth-only probes."),
) -> None:
    params = {
        "provider": provider,
        "output_file": output_file,
        "recaptcha_action": recaptcha_action,
    }
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

@app.callback()
def main_callback(
    ctx: typer.Context,
    json_output: bool = typer.Option(False, "--json", help="Output JSON."),
    interactive_login: bool | None = typer.Option(
        None,
        "--interactive-login/--no-interactive-login",
        help="Override terminal detection for shared Hub login recovery.",
    ),
) -> None:
    ctx.obj = {"json_output": json_output, "interactive_login": interactive_login}


def main() -> None:
    app()
