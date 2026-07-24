import json
import sys
from typing import Any

from pydantic import BaseModel, Field
from rich.console import Console


def _force_utf8_stream(stream: Any) -> None:
    """PyInstaller on Windows may otherwise inherit the active ANSI code page."""
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError, ValueError):
        pass


_force_utf8_stream(sys.stdout)
_force_utf8_stream(sys.stderr)
console = Console(force_terminal=False, color_system=None)


class CommandResponse(BaseModel):
    success: bool
    platform: str
    command: str
    data: dict[str, Any] = Field(default_factory=dict)


def emit_response(response: CommandResponse, *, as_json: bool) -> None:
    payload = response.model_dump()
    if as_json:
        console.print_json(data=payload)
        return

    console.print(f"[bold green]success[/bold green]: {response.success}")
    console.print(f"[bold]platform[/bold]: {response.platform}")
    console.print(f"[bold]command[/bold]: {response.command}")
    console.print_json(data=payload["data"])
