from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from ops_cli.capabilities import CapabilityExecution, CapabilitySpec, bind_capability_execution
from ops_cli.output import CommandResponse
from ops_cli.runtime_context import write_runtime_context


def _artifact_paths(data: dict[str, Any]) -> list[str]:
    artifacts = data.get("artifacts")
    if isinstance(artifacts, list):
        return [str(item) for item in artifacts if item]
    paths: list[str] = []
    for key in ("output_path", "statement_list_path", "file_path"):
        value = data.get(key)
        if value:
            paths.append(str(value))
    downloaded = data.get("downloaded_files")
    if isinstance(downloaded, list):
        paths.extend(str(item) for item in downloaded if item)
    return list(dict.fromkeys(paths))


def _context_task_name(spec: CapabilitySpec) -> str:
    return f"capability_{spec.id.replace('.', '_').replace('-', '_')}"


def _update_existing_context(path: str | Path, recovery: dict[str, object]) -> None:
    context_path = Path(path)
    if not context_path.is_file():
        return
    try:
        payload = json.loads(context_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    outputs = payload.setdefault("outputs", {})
    if isinstance(outputs, dict):
        outputs["session_recovery"] = recovery
    context_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _decorate_success(
    spec: CapabilitySpec,
    params: dict[str, Any],
    response: CommandResponse,
    execution: CapabilityExecution,
) -> CommandResponse:
    data = response.data
    data.setdefault("capability_id", spec.id)
    data.setdefault("artifacts", _artifact_paths(data))
    if not response.success:
        data.setdefault("error_code", "PLATFORM_REQUEST_FAILED")
        data.setdefault("retryable", True)
        # 无法判断提交阶段时按「已提交」处理：上层据此拒绝重试。
        # 宁可让用户手动点一次重新生成，也不能自动二次提交、重复扣配额。
        data.setdefault("submitted", True)
        data.setdefault("required_scenes", list(spec.scenes))
        data.setdefault("recovery_hint", None)
    recovery = execution.recovery.as_dict()
    data["session_recovery"] = recovery
    if data.get("context_path"):
        _update_existing_context(str(data["context_path"]), recovery)
    else:
        context_path = write_runtime_context(
            task_name=_context_task_name(spec),
            status="success" if response.success else "failed",
            inputs=params,
            outputs={"capability_id": spec.id, "session_recovery": recovery},
            artifacts=data["artifacts"],
        )
        data["context_path"] = str(context_path)
    return response


def run_capability(
    *,
    spec: CapabilitySpec,
    params: dict[str, Any],
    handler: Callable[[], CommandResponse],
    interactive_login: bool | None,
) -> CommandResponse:
    with bind_capability_execution(
        spec,
        dry_run=bool(params.get("dry_run", False)),
        interactive_login=interactive_login,
    ) as execution:
        return _decorate_success(spec, params, handler(), execution)


def _classify_error(exc: Exception) -> tuple[str, bool, str | None]:
    custom_code = getattr(exc, "error_code", None)
    if custom_code:
        return (
            str(custom_code),
            bool(getattr(exc, "retryable", False)),
            getattr(exc, "recovery_hint", None),
        )
    text = str(exc)
    lowered = text.lower()
    if "模板" in text or "template" in lowered:
        return "TEMPLATE_MISSING", False, None
    if any(word in lowered for word in ("auth", "session", "cookie", "401", "403", "unauthorized")) or any(
        word in text for word in ("登录", "鉴权", "scene 不可用", "Scene 校验")
    ):
        return "AUTH_REQUIRED", True, "请在应用打开的系统共享 Chrome 中完成登录后重试。"
    if "捕获" in text or "复检" in text or "capture" in lowered:
        return "SCENE_CAPTURE_FAILED", True, "请在交互终端执行同一命令，完成登录后由脚本重新捕获 scene。"
    if any(word in text for word in ("Excel", "xlsx", "下载内容不是合法", "下载内容为空", "文件不存在")):
        return "ARTIFACT_INVALID", True, None
    return "PLATFORM_REQUEST_FAILED", True, None


def capability_failure_response(
    *,
    spec: CapabilitySpec,
    params: dict[str, Any],
    exc: Exception,
    interactive_login: bool | None,
) -> CommandResponse:
    code, retryable, recovery_hint = _classify_error(exc)
    response_diagnostics = getattr(exc, "response_diagnostics", None)
    with bind_capability_execution(
        spec,
        dry_run=bool(params.get("dry_run", False)),
        interactive_login=interactive_login,
    ) as execution:
        if code in {"AUTH_REQUIRED", "SCENE_CAPTURE_FAILED"}:
            execution.recovery.mark_required()
        recovery = execution.recovery.as_dict()
        outputs = {"capability_id": spec.id, "session_recovery": recovery}
        if isinstance(response_diagnostics, dict):
            outputs["response_diagnostics"] = response_diagnostics
        context_path = write_runtime_context(
            task_name=_context_task_name(spec),
            status="failed",
            inputs=params,
            outputs=outputs,
            errors=[str(exc)],
        )
    data = {
        "error": str(exc),
        "capability_id": spec.id,
        "artifacts": [],
        "context_path": str(context_path),
        "session_recovery": recovery,
        "error_code": code,
        "retryable": retryable,
        # 只有确定「还没提交」的失败才允许上层自动重试，见 provider 里的 submitted 标记。
        "submitted": bool(getattr(exc, "submitted", True)),
        "required_scenes": list(spec.scenes),
        "recovery_hint": recovery_hint,
    }
    if isinstance(response_diagnostics, dict):
        data["response_diagnostics"] = response_diagnostics
    return CommandResponse(
        success=False,
        platform=spec.platform,
        command=spec.command,
        data=data,
    )
