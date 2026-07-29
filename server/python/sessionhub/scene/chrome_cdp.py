from __future__ import annotations

import json
import logging
import socket
import subprocess
import time
import urllib.error
import urllib.request
import os
import signal
import sys
import traceback
from pathlib import Path


CDP_HOST = "127.0.0.1"
CDP_PORT = int(os.environ.get("SESSIONHUB_CDP_PORT", "19222"))
CDP_URL = f"http://{CDP_HOST}:{CDP_PORT}"
# Evan reuses the machine's Google Chrome binary with its own persistent profile.
# The installer never reads or controls the user's daily Chrome profile.
IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"


def _default_chrome_bin() -> Path:
    """定位系统 Google Chrome；显式环境变量优先。"""
    override = (
        os.environ.get("EVAN_CHROME_EXECUTABLE", "").strip()
        or os.environ.get("EVAN_BROWSER_EXECUTABLE", "").strip()
        or os.environ.get("SESSIONHUB_CHROME_APP", "").strip()
    )
    if override:
        return Path(override)
    if IS_MACOS:
        system = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        user = Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        return system if system.exists() else user
    if IS_WINDOWS:
        roots = [
            os.environ.get("PROGRAMFILES", ""),
            os.environ.get("PROGRAMFILES(X86)", ""),
            os.environ.get("LOCALAPPDATA", ""),
        ]
        for root in roots:
            candidate = Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if root and candidate.exists():
                return candidate
        return Path("chrome.exe")
    for candidate in (Path("/usr/bin/google-chrome-stable"), Path("/usr/bin/google-chrome")):
        if candidate.exists():
            return candidate
    return Path("google-chrome")


CHROME_BIN = _default_chrome_bin()
_DEFAULT_PROFILE_NAME = "evan-browser"


def _default_profile_dir() -> Path:
    """没有显式配置时的 Evan 专属 Profile 位置。

    必须和 Electron 的 userData 落在同一处。此前回退到 ~/.sessionhub/evan-browser，
    于是任何没带 SESSIONHUB_CHROME_PROFILE 的调用都会**另起一个全新的空 Chrome**，
    还会占住 19222 —— 应用那边按自己的路径匹配不到进程，直接判「端口被占用」硬失败，
    登录检查永远停在「无法确认」，而用户明明已经在专属浏览器里登录过了。
    专属实例只能有一个，所以这里对齐 Electron 的 app.getPath('userData')。
    """
    app_name = "Evan AI Video Canvas"
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / app_name
    elif os.name == "nt":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) / app_name if appdata else Path.home() / "AppData" / "Roaming" / app_name
    else:
        config_home = os.environ.get("XDG_CONFIG_HOME")
        base = (Path(config_home) if config_home else Path.home() / ".config") / app_name
    return base / "data" / "browser-profile"


PROFILE_DIR = Path(
    os.environ.get("SESSIONHUB_CHROME_PROFILE")
    or os.environ.get("EVAN_BROWSER_PROFILE_DIR")
    or str(_default_profile_dir())
)


def _detached_popen_kwargs() -> dict:
    """让 Chrome 脱离本进程独立存活。

    POSIX 用 start_new_session；Windows 没有这个参数（传了会 ValueError），
    要用 DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP。
    """
    if IS_WINDOWS:
        flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
        flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        return {"creationflags": flags}
    return {"start_new_session": True}


def is_port_open(host: str = CDP_HOST, port: int = CDP_PORT, timeout: float = 0.5) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def check_cdp() -> tuple[bool, str]:
    if not is_port_open():
        return False, f"{CDP_PORT} 端口未开启，Evan 专属 Chrome CDP 未启动。"
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as resp:
            info = json.loads(resp.read().decode("utf-8"))
        browser = info.get("Browser", "Chrome")
        return True, f"Chrome CDP 可用：{browser}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logging.exception("CDP 连接失败")
        return False, f"{CDP_PORT} 端口存在，但 CDP 响应异常：{exc}"


def chrome_start_command() -> str:
    return (
        f'"{CHROME_BIN}" '
        "--remote-allow-origins=* "
        f"--remote-debugging-port={CDP_PORT} "
        f'--user-data-dir="{PROFILE_DIR}" '
        "--lang=en-US --no-first-run --no-default-browser-check --new-window about:blank"
    )


def _foreground_allowed() -> bool:
    """是否允许把 Evan 专属 Chrome 切到前台（弹窗）。

    仅当有人正坐在终端前（stdin 是 tty）才允许弹窗：终端直跑 ops / learn 登录时正常弹。
    launchd 定时、Hermes、workflow 子进程都经 osascript 空环境启动，无 tty → 静默不弹，
    避免后台会话失效时把 Chrome 弹到前台打扰用户。可用 OPS_FORCE_LOGIN_POPUP=1 强制开启。
    """
    forced = os.environ.get("OPS_FORCE_LOGIN_POPUP", "").strip().lower() in {"1", "true", "yes", "on"}
    if forced:
        _debug_log("_foreground_allowed", allowed=True, reason="OPS_FORCE_LOGIN_POPUP")
        return True
    try:
        allowed = bool(sys.stdin and sys.stdin.isatty())
    except Exception:
        allowed = False
    _debug_log("_foreground_allowed", allowed=allowed, stdin_isatty=allowed)
    return allowed


def foreground_allowed() -> bool:
    return _foreground_allowed()


def _debug_log(event: str, **details: object) -> None:
    if os.environ.get("OPS_CHROME_CDP_DEBUG", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return
    stack = " <- ".join(
        f"{Path(frame.filename).name}:{frame.lineno}:{frame.name}"
        for frame in traceback.extract_stack(limit=6)[:-1]
    )
    payload = " ".join(f"{key}={value}" for key, value in details.items())
    line = f"[chrome_cdp] {event} {payload} caller={stack}"
    debug_file = os.environ.get("OPS_CHROME_CDP_DEBUG_FILE", "").strip()
    if debug_file:
        try:
            with open(debug_file, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            return
        except OSError:
            pass
    print(line, file=sys.stderr, flush=True)


def _instance_pid() -> int | None:
    """使用 Evan profile 的专属 Chrome 顶层进程 PID。

    按 ``--user-data-dir=<PROFILE_DIR>`` 精确匹配，只锁定 Evan 实例，
    绝不误伤用户日常浏览器。
    """
    if IS_WINDOWS:
        return _instance_pid_windows()
    try:
        result = subprocess.run(
            ["pgrep", "-f", f"user-data-dir={PROFILE_DIR}"],
            text=True,
            capture_output=True,
            check=False,
        )
    except Exception:
        return None
    candidates: list[int] = []
    for token in result.stdout.split():
        try:
            pid = int(token.strip())
        except ValueError:
            continue
        if pid == os.getpid():
            continue
        candidates.append(pid)
    if not candidates:
        return None
    # 顶层主进程：没有 --type=，也不是 Helper。登录实例不开放 CDP，不能只按
    # remote-debugging-port 判断，否则可能误把渲染/GPU 子进程当成主进程。
    for pid in candidates:
        try:
            cmd = subprocess.run(
                ["ps", "-o", "command=", "-p", str(pid)],
                text=True,
                capture_output=True,
                check=False,
            ).stdout
        except Exception:
            cmd = ""
        if "Helper" not in cmd and "--type=" not in cmd:
            return pid
    return candidates[0]


def _powershell(script: str) -> str:
    """执行一段 PowerShell 并返回 stdout；失败返回空串。"""
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            text=True,
            capture_output=True,
            check=False,
        )
    except Exception:
        return ""
    return proc.stdout if proc.returncode == 0 else ""


def _instance_details_windows() -> tuple[int, str] | None:
    """一次查询专用实例的 PID 与命令行。

    ``Get-CimInstance`` 在部分 Windows 电脑上启动很慢，所以调用方必须复用这次
    查询结果，不能在轮询里反复启动 PowerShell。
    """
    marker = f"user-data-dir={PROFILE_DIR}"
    out = _powershell(
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
    )
    fallback: tuple[int, str] | None = None
    for line in out.splitlines():
        pid_text, _, cmdline = line.partition("\t")
        try:
            pid = int(pid_text.strip())
        except ValueError:
            continue
        if marker not in cmdline:
            continue
        if "--type=" not in cmdline:
            return pid, cmdline  # 顶层主进程；可见登录实例没有 remote-debugging-port
        if fallback is None:
            fallback = (pid, cmdline)
    return fallback


def _instance_pid_windows() -> int | None:
    """按 --user-data-dir 精确匹配专用实例，绝不误伤用户日常 Chrome。"""
    details = _instance_details_windows()
    return details[0] if details else None


_KERNEL32 = None


def _kernel32():
    """惰性加载并缓存 kernel32。

    绝不能在模块导入时做：这个模块在 macOS 上也会被导入，``ctypes.WinDLL`` 只存在于
    Windows。缓存则是因为下面两个轮询循环每 100~250ms 调一次，每次都重新 WinDLL +
    重设 argtypes 纯属浪费。
    """
    global _KERNEL32
    if _KERNEL32 is None:
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        _KERNEL32 = kernel32
    return _KERNEL32


def _windows_pid_is_running(pid: int) -> bool | None:
    """用 Win32 进程句柄查询 PID，避免每 250ms 冷启动一次 PowerShell。

    返回 ``None`` 代表权限或系统调用异常；关闭流程会把它按“仍在运行”处理并在
    超时后只对已经核验过 Profile 的原 PID 强制结束，绝不扩大目标范围。
    """
    if not IS_WINDOWS:
        return None
    try:
        import ctypes

        synchronize = 0x00100000
        wait_object_0 = 0x00000000
        wait_timeout = 0x00000102
        kernel32 = _kernel32()
        handle = kernel32.OpenProcess(synchronize, False, int(pid))
        if not handle:
            # ERROR_INVALID_PARAMETER 表示 PID 已不存在；其它错误（例如拒绝访问）
            # 不能安全地当成“已退出”。
            return False if ctypes.get_last_error() == 87 else None
        try:
            result = kernel32.WaitForSingleObject(handle, 0)
            if result == wait_object_0:
                return False
            if result == wait_timeout:
                return True
            return None
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return None


def _instance_command(pid: int) -> str:
    if IS_WINDOWS:
        return _powershell(
            f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"
        )
    try:
        return subprocess.run(
            ["ps", "-o", "command=", "-p", str(pid)],
            text=True,
            capture_output=True,
            check=False,
        ).stdout
    except Exception:
        return ""


def _instance_is_headless(pid: int, command: str | None = None) -> bool:
    if IS_WINDOWS:
        # Chromium 的 `Browser` 字段在新无头模式下也可能仍是
        # "Chrome/1xx"，不能据此判断。先看已按 PID 精确取得的命令行，
        # 再用 CDP User-Agent 中的 HeadlessChrome 兜底。
        resolved_command = command if command is not None else _instance_command(pid)
        if "--headless" in resolved_command.lower():
            return True
        try:
            with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as resp:
                info = json.loads(resp.read().decode("utf-8"))
            return "headlesschrome" in str(info.get("User-Agent", "")).lower()
        except Exception:
            return False
    return "--headless" in _instance_command(pid)


def _instance_supports_playwright(pid: int, command: str | None = None) -> bool:
    """生成实例必须带 Evan 指定的 CDP 跨源参数，登录实例不会命中。"""
    resolved_command = command if command is not None else _instance_command(pid)
    normalized = resolved_command.lower()
    return "--remote-allow-origins" in normalized and "--enable-automation" in normalized


def _windows_login_instance_reusable(command: str) -> bool:
    """普通登录实例可以直接复用；自动化/无头实例必须先安全切换模式。"""
    normalized = command.lower()
    automation_markers = (
        "--headless",
        "--remote-debugging-port",
        "--remote-allow-origins",
        "--enable-automation",
    )
    return not any(marker in normalized for marker in automation_markers)


def start_login_chrome(url: str) -> tuple[bool, str]:
    """用普通 Chrome 模式打开登录页，不暴露 CDP/自动化参数。

    登录完成后的站点状态写入 Evan 专属 profile。后续生成会关闭这个可见实例，
    再以无头 CDP 模式启动同一个 profile，因此不会触碰日常 Chrome 数据。
    """
    if not CHROME_BIN.exists():
        return False, f"找不到 Google Chrome：{CHROME_BIN}"
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    launch_cmd = [
        str(CHROME_BIN),
        "--lang=zh-CN",
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        url,
    ]

    if IS_WINDOWS:
        details = _instance_details_windows()
        if details:
            pid, command = details
            if _windows_login_instance_reusable(command):
                # 同一 user-data-dir 的第二次普通启动会把 URL 交给现有登录实例。
                # 不需要先关再开，用户重复点登录入口时可以立即响应。
                subprocess.Popen(
                    launch_cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    **_detached_popen_kwargs(),
                )
                return True, "已在现有 Evan 专属 Chrome 中打开登录页"
            stop_chrome(pid)
    else:
        stop_chrome()

    process = subprocess.Popen(
        launch_cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **_detached_popen_kwargs(),
    )
    if IS_WINDOWS:
        # 这是刚由本函数使用明确 Profile 启动的 PID，可以直接用原生句柄确认，
        # 无需再为每次轮询启动 PowerShell/CIM。
        for _ in range(30):
            running = _windows_pid_is_running(process.pid)
            if running is True:
                return True, "Evan 专属 Chrome 登录窗口已打开"
            if running is False:
                break
            time.sleep(0.1)
        # Chrome 极少数情况下会把启动转交给另一个新进程；只做一次精确兜底查询。
        if _instance_pid_windows() is not None:
            return True, "Evan 专属 Chrome 登录窗口已打开"
        return False, "已启动 Google Chrome，但未检测到 Evan 专属实例"

    for _ in range(30):
        pid = _instance_pid()
        if pid is not None:
            # 这是用户明确触发的登录动作，不受后台任务的前台弹窗开关限制。
            if IS_MACOS:
                _system_events(
                    f'tell application "System Events" to set frontmost of first process whose unix id is {pid} to true'
                )
            return True, "Evan 专属 Chrome 登录窗口已打开"
        time.sleep(0.25)
    return False, "已启动 Google Chrome，但未检测到 Evan 专属实例"


def _system_events(*statements: str) -> bool:
    """对指定 System Events 语句执行 osascript，全部失败返回 False。"""
    if not IS_MACOS:
        return False
    args = ["/usr/bin/osascript"]
    for stmt in statements:
        args.extend(["-e", stmt])
    try:
        proc = subprocess.run(
            args,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return proc.returncode == 0
    except Exception:
        return False


def _process_window_state(pid: int) -> dict[str, object] | None:
    script = """
on run argv
  set targetPid to item 1 of argv as integer
  tell application "System Events"
    set matches to processes whose unix id is targetPid
    if (count of matches) is 0 then return "missing"
    set p to item 1 of matches
    return "visible=" & (visible of p as string) & "|frontmost=" & (frontmost of p as string) & "|windows=" & ((count of windows of p) as string)
  end tell
end run
"""
    if not IS_MACOS:
        return None
    try:
        proc = subprocess.run(
            ["/usr/bin/osascript", "-e", script, str(pid)],
            text=True,
            capture_output=True,
            check=False,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    output = proc.stdout.strip()
    if output == "missing" or not output:
        return None
    state: dict[str, object] = {}
    for part in output.split("|"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key in {"visible", "frontmost"}:
            state[key] = value.strip().lower() == "true"
        elif key == "windows":
            try:
                state[key] = int(value)
            except ValueError:
                state[key] = 0
    return state or None


def _wait_until_hidden(pid: int, *, max_wait_seconds: float = 2.0, poll_interval: float = 0.1) -> bool:
    deadline = time.monotonic() + max_wait_seconds
    while True:
        state = _process_window_state(pid)
        _debug_log("hide_chrome.state", pid=pid, state=state)
        if state is not None and state.get("visible") is False and state.get("frontmost") is False:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(poll_interval)


def bring_chrome_to_front() -> tuple[bool, str]:
    _debug_log("bring_chrome_to_front.enter")
    if not IS_MACOS:
        # 非 macOS 无 osascript 等价物。切前台只影响登录时的体验（把浏览器弹到最前），
        # 不影响生成本身，故静默降级。**绝不能抛异常**：调用方会把异常归类成
        # AUTH_REQUIRED，用户会看到莫名其妙的「请重新登录」。
        _debug_log("bring_chrome_to_front.skip", reason="not_macos")
        return False, "当前平台不支持自动切前台，请手动切到 Evan 专属 Chrome 窗口"
    if not _foreground_allowed():
        # 非交互式（后台/定时/Hermes）运行：静默跳过切前台，调用方仍会抛出登录错误。
        _debug_log("bring_chrome_to_front.skip", reason="foreground_not_allowed")
        return False, "非交互式运行，跳过切前台（避免后台弹窗）"
    pid = _instance_pid()
    if pid is None:
        _debug_log("bring_chrome_to_front.skip", reason="no_pid")
        return False, "未找到 Evan 专属 Chrome 实例，跳过切前台"
    ok = _system_events(
        f"tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to true",
        f"tell application \"System Events\" to set frontmost of (first process whose unix id is {pid}) to true",
    )
    if ok:
        _debug_log("bring_chrome_to_front.ok", pid=pid)
        return True, "已将 Evan 专属 Chrome 切到前台"
    _debug_log("bring_chrome_to_front.failed", pid=pid)
    return False, "切换 Evan 专属 Chrome 到前台失败"


def hide_chrome(*, max_wait_seconds: float = 2.0, poll_interval: float = 0.1) -> tuple[bool, str]:
    _debug_log("hide_chrome.enter")
    if not IS_MACOS:
        _debug_log("hide_chrome.skip", reason="not_macos")
        return False, "当前平台不支持自动隐藏窗口"
    pid = _instance_pid()
    if pid is None:
        # 找不到专用实例时什么都不做，避免误伤用户日常 Chrome。
        _debug_log("hide_chrome.skip", reason="no_pid")
        return False, "未找到 Evan 专属 Chrome 实例，跳过隐藏"
    ok = _system_events(
        f"tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to false",
    )
    if ok and _wait_until_hidden(pid, max_wait_seconds=max_wait_seconds, poll_interval=poll_interval):
        _debug_log("hide_chrome.ok", pid=pid)
        return True, "已将 Evan 专属 Chrome 隐藏到后台"
    if ok:
        _debug_log("hide_chrome.unconfirmed", pid=pid)
        return False, "隐藏 Evan 专属 Chrome 命令已发送，但未确认隐藏"
    _debug_log("hide_chrome.failed", pid=pid)
    return False, "隐藏 Evan 专属 Chrome 失败"


def surface_for_login(reason: str) -> None:
    """统一的「需要登录」出口：把 Evan 专属 Chrome 切到前台让用户手动登录，并抛错中断。

    这是专属 Chrome 唯一允许主动弹窗的场景。其余自动化行为一律静默（后台运行）。
    """
    _debug_log("surface_for_login", reason=reason)
    bring_chrome_to_front()
    raise RuntimeError(reason)


def stop_chrome(known_pid: int | None = None) -> tuple[bool, str]:
    if IS_WINDOWS:
        # known_pid 只能来自本模块刚按 --user-data-dir 精确核验的查询结果。
        pid = known_pid if known_pid is not None else _instance_pid_windows()
        if pid is None:
            return True, "未找到专用 Chrome，无需关闭"
        # 先不带 /F 请求正常退出，让 Chrome 有机会完整落盘 Cookie/Profile；超时才强杀。
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T"],
            capture_output=True,
            check=False,
        )
        for _ in range(20):
            if _windows_pid_is_running(pid) is False and not is_port_open():
                return True, "已关闭专用 Chrome"
            time.sleep(0.25)
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
        for _ in range(20):
            if _windows_pid_is_running(pid) is False and not is_port_open():
                break
            time.sleep(0.1)
        # 只有**确认还活着**才算失败。查不出来（None，多为权限受限）一律按已关闭处理：
        # 那类机器上 OpenProcess 本来就拿不到句柄，报失败会把它们全部挡在启动之外。
        if _windows_pid_is_running(pid) is True:
            return False, (
                f"无法结束 Evan 专属 Chrome 进程（PID {pid}）。"
                "请在任务管理器中手动结束该 chrome.exe 后重试。"
            )
        return True, "已强制关闭专用 Chrome"

    main_pid = _instance_pid()
    if main_pid is None:
        return True, "未找到专用 Chrome，无需关闭"
    # 只给主进程 SIGTERM。Chrome 会自行通知 Helper 退出并刷新 Cookie 数据库；旧实现
    # 同时 SIGTERM 全部 Helper，登录刚完成就切换无头时可能来不及持久化登录态。
    try:
        os.kill(main_pid, signal.SIGTERM)
    except ProcessLookupError:
        return True, "已关闭专用 Chrome"

    for _ in range(30):
        if _instance_pid() is None and not is_port_open():
            return True, "已关闭专用 Chrome"
        time.sleep(0.2)

    # 正常退出超时后，只强杀仍属于 Evan Profile 的进程，绝不触碰日常 Chrome。
    try:
        result = subprocess.run(
            ["pgrep", "-f", str(PROFILE_DIR)],
            text=True,
            capture_output=True,
            check=False,
        )
        pids = [int(line) for line in result.stdout.splitlines() if line.strip().isdigit()]
    except Exception as exc:
        return False, f"查找专用 Chrome 失败：{exc}"
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    # SIGKILL is asynchronous on macOS. Wait briefly so callers can rely on
    # memory having actually been reclaimed when this function returns.
    for _ in range(20):
        remaining = []
        for pid in pids:
            try:
                os.kill(pid, 0)
                remaining.append(pid)
            except ProcessLookupError:
                pass
        if not remaining:
            break
        time.sleep(0.1)
    return True, "已强制关闭专用 Chrome"


def start_chrome(
    force: bool = False,
    *,
    foreground: bool = False,
    headless: bool = False,
    initial_url: str = "about:blank",
) -> tuple[bool, str]:
    _debug_log("start_chrome.enter", force=force, foreground=foreground, headless=headless)
    launch_url = str(initial_url or "about:blank").strip()
    if launch_url != "about:blank" and not launch_url.startswith(("https://", "http://")):
        launch_url = "about:blank"
    ok, msg = check_cdp()
    stopped_existing = False
    if IS_WINDOWS:
        details = _instance_details_windows()
        pid = details[0] if details else None
        command = details[1] if details else None
    else:
        pid = _instance_pid()
        command = None

    # 关键修复：可见登录实例不开放 CDP。旧逻辑只有 ok=True 才检查实例，因此会直接
    # 再启动一个同 Profile 的无头 Chrome；Chrome 单实例机制把参数交给可见实例后退出，
    # 19222 永远不会出现，最终报“已启动 Chrome，但 CDP 仍不可用”。
    if not ok and pid is not None:
        _debug_log("start_chrome.restart_existing_without_cdp", pid=pid)
        closed, close_message = stop_chrome(pid if IS_WINDOWS else None)
        if not closed:
            # 旧实例还占着同一个 Profile，硬着头皮启动只会被 Chrome 单实例机制吞掉：
            # 用户要干等满 CDP 超时，最后拿到一句无从下手的通用错误。
            # 直接把「没关掉、请去任务管理器结束」这条可执行的提示交回给用户。
            _debug_log("start_chrome.stop_failed", pid=pid, message=close_message)
            return False, close_message
        stopped_existing = True
        pid = None
        command = None

    if ok and not force:
        if pid is None:
            return False, (
                f"{CDP_PORT} 端口被另一个浏览器实例占用，且它用的不是 Evan 专属 Profile"
                f"（{PROFILE_DIR}）。没有复用它，以免把任务发到错误的浏览器资料上。"
                f"请退出 Evan、结束占用该端口的浏览器进程后重新打开 Evan。"
            )
        if pid is not None and not _instance_supports_playwright(pid, command):
            # 升级后的首次运行可能仍残留旧参数实例。保留 profile，重启进程即可，
            # 否则 connect_over_cdp 会报 Browser.setDownloadBehavior 协议错误。
            _debug_log("start_chrome.restart_for_playwright", pid=pid)
            stop_chrome(pid if IS_WINDOWS else None)
            ok = False
        elif headless and pid is not None and not _instance_is_headless(pid, command):
            _debug_log("start_chrome.restart_for_headless", pid=pid)
            stop_chrome(pid if IS_WINDOWS else None)
            ok = False
        elif (
            not headless
            and pid is not None
            and _instance_is_headless(pid, command)
            and (foreground or _foreground_allowed())
        ):
            _debug_log("start_chrome.restart_for_headful_foreground", pid=pid)
            stop_chrome(pid if IS_WINDOWS else None)
            ok = False
    if ok and not force:
        # 默认静默：已在运行时也把专用窗口压回后台，避免上一次登录/操作残留的前台窗口
        # 在后续自动化里持续打扰。仅当显式 foreground（登录场景）才切前台。
        if foreground:
            bring_chrome_to_front()
        elif not headless:
            hide_chrome()
        _debug_log("start_chrome.reuse", foreground=foreground, headless=headless, message=msg)
        return True, msg
    if force and not stopped_existing:
        # 复用上面那次核验结果：Windows 上 stop_chrome() 不带 pid 会再跑一次
        # Get-CimInstance Win32_Process，部分机器上要好几秒。
        stop_chrome(pid if IS_WINDOWS else None)
    if not CHROME_BIN.exists():
        return False, f"找不到 Chrome：{CHROME_BIN}"
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    low_memory_args = [
        # 只用于无头探针/生成实例。手动登录走 start_login_chrome，不带此参数。
        # Chrome 149+ 缺少它时，CDP 虽可连接但 Target.createTarget 会拒绝新标签页。
        "--enable-automation",
        "--remote-allow-origins=*",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-service-autorun",
    ]
    # 默认无头：真正要新拉起实例时，若无人坐在终端前且未显式要求前台，
    # 则静默启动。需要登录或开启调试模式时再使用可见窗口。
    if not headless and not foreground and not _foreground_allowed():
        headless = True
        _debug_log("start_chrome.default_headless", reason="no_tty_background")
    if headless:
        launch_cmd = [
            str(CHROME_BIN),
            *low_memory_args,
            "--headless=new",
            "--lang=en-US",
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
            # 固定离屏视口，保证 fund 资金表等凭证截图尺寸稳定、内容不被裁切。
            "--window-size=1440,900",
            launch_url,
        ]
    else:
        # Direct execution with a dedicated user-data-dir creates a separate
        # Chrome process and never joins the user's daily Chrome profile.
        launch_cmd = [
            str(CHROME_BIN),
            *low_memory_args,
            "--lang=en-US",
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window",
            "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
            launch_url,
        ]
    detached = _detached_popen_kwargs()
    if foreground and not headless:
        subprocess.Popen(
            launch_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **detached,
        )
    else:
        subprocess.Popen(
            launch_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            **detached,
        )
    for _ in range(20):
        ok, msg = check_cdp()
        if ok:
            if foreground and not headless:
                bring_chrome_to_front()
            elif not headless:
                hide_chrome()
            _debug_log("start_chrome.started", foreground=foreground, headless=headless, message=msg)
            return True, msg
        time.sleep(0.5)
    logging.error("Chrome CDP 启动超时")
    return False, (
        f"已尝试启动 Evan 专属 Chrome，但本机端口 {CDP_PORT} 的自动化连接仍不可用。"
        "请完全退出 Evan 后重试；如果持续出现，请检查安全软件是否拦截 Chrome 的本机连接。"
    )
