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
CDP_PORT = 9222
CDP_URL = f"http://{CDP_HOST}:{CDP_PORT}"
# 专用浏览器渠道：默认用 Chrome Beta。它的 bundle id 独立（com.google.Chrome.beta），
# 与日常 Stable Chrome 从系统层面隔离，双击 .html / 点链接不会误投到本自动化实例。
# 可用 SESSIONHUB_CHROME_BUNDLE / _APP / _PROFILE 环境变量覆盖以切换渠道或路径。
IS_WINDOWS = sys.platform == "win32"
IS_MACOS = sys.platform == "darwin"

CHROME_APP_NAME = os.environ.get("SESSIONHUB_CHROME_BUNDLE", "Google Chrome Beta")


def _default_chrome_bin() -> Path:
    """按平台推导专用浏览器可执行文件。

    macOS 默认用 Chrome Beta（bundle id 独立，与日常 Stable 隔离）。
    Windows 上一般只装一个 Chrome，按常见安装位置依次探测；探测不到就返回
    第一个候选，让 start_chrome 报出「找不到 Chrome」并提示用
    SESSIONHUB_CHROME_APP 指定。
    """
    override = os.environ.get("SESSIONHUB_CHROME_APP", "").strip()
    if override:
        return Path(override)

    if IS_MACOS:
        return Path(f"/Applications/{CHROME_APP_NAME}.app/Contents/MacOS/{CHROME_APP_NAME}")

    if IS_WINDOWS:
        roots = [
            Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")),
            Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")),
            Path(os.environ.get("LOCALAPPDATA", "")),
        ]
        # Beta 优先：Windows 上窗口隐藏是 no-op（没有 osascript 等价物），
        # 自动化窗口会一直显示在桌面上。若用与日常同款的 Chrome，用户极易
        # 把它当成自己的窗口顺手关掉，触发 BROWSER_CLOSED 中断生成。
        # Beta 图标颜色不同，一眼可辨。找不到 Beta 再回退到普通 Chrome。
        candidates = [root / "Google/Chrome Beta/Application/chrome.exe" for root in roots]
        candidates += [root / "Google/Chrome/Application/chrome.exe" for root in roots]
    else:  # Linux 等
        candidates = [
            Path("/usr/bin/google-chrome-beta"),
            Path("/usr/bin/google-chrome"),
            Path("/usr/bin/chromium"),
            Path("/usr/bin/chromium-browser"),
        ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


CHROME_BIN = _default_chrome_bin()
# 配置目录名不再带 -beta：非 macOS 上用的是普通 Chrome 渠道。
_DEFAULT_PROFILE_NAME = "chrome-9222-beta" if IS_MACOS else "chrome-9222"
PROFILE_DIR = Path(
    os.environ.get(
        "SESSIONHUB_CHROME_PROFILE",
        str(Path.home() / ".sessionhub" / _DEFAULT_PROFILE_NAME),
    )
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
        return False, "9222 端口未开启，Chrome CDP 未启动。"
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as resp:
            info = json.loads(resp.read().decode("utf-8"))
        browser = info.get("Browser", "Chrome")
        return True, f"Chrome CDP 可用：{browser}"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        logging.exception("CDP 连接失败")
        return False, f"9222 端口存在，但 CDP 响应异常：{exc}"


def chrome_start_command() -> str:
    if IS_MACOS:
        return (
            f'open -na "{CHROME_APP_NAME}" --args '
            f"--remote-debugging-port={CDP_PORT} "
            f'--user-data-dir="{PROFILE_DIR}" '
            "--new-window about:blank"
        )
    return (
        f'"{CHROME_BIN}" '
        f"--remote-debugging-port={CDP_PORT} "
        f'--user-data-dir="{PROFILE_DIR}" '
        "--no-first-run --no-default-browser-check --new-window about:blank"
    )


def _foreground_allowed() -> bool:
    """是否允许把 9222 Chrome 切到前台（弹窗）。

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
    """专用 9222 Chrome 顶层进程 PID。

    关键：按 ``--user-data-dir=<PROFILE_DIR>`` 精确匹配，只锁定这个专用实例，
    绝不误伤用户日常 Chrome。历史 bug 就是 ``tell application "Google Chrome"``
    按应用名寻址，Apple 事件落到了用户主 Chrome 上，专用 9222 窗口从未被真正隐藏，
    于是后台自动化每次都把 9222 窗口晾在前台 → 用户看到「弹窗」。
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
    # 顶层主进程：命令行含 remote-debugging-port 且不是 Helper 子进程。
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
        if "remote-debugging-port" in cmd and "Helper" not in cmd:
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


def _instance_pid_windows() -> int | None:
    """按 --user-data-dir 精确匹配专用实例，绝不误伤用户日常 Chrome。"""
    marker = f"user-data-dir={PROFILE_DIR}"
    out = _powershell(
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"
    )
    fallback: int | None = None
    for line in out.splitlines():
        pid_text, _, cmdline = line.partition("\t")
        try:
            pid = int(pid_text.strip())
        except ValueError:
            continue
        if marker not in cmdline:
            continue
        if "--remote-debugging-port" in cmdline and "--type=" not in cmdline:
            return pid  # 顶层主进程（--type= 的是渲染/GPU 子进程）
        if fallback is None:
            fallback = pid
    return fallback


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


def _instance_is_headless(pid: int) -> bool:
    if IS_WINDOWS:
        # Windows 上查命令行较慢且易受引号影响，直接问 CDP：
        # 无头实例的 Browser 字段形如 "HeadlessChrome/1xx.x.x.x"。
        try:
            with urllib.request.urlopen(f"{CDP_URL}/json/version", timeout=2) as resp:
                info = json.loads(resp.read().decode("utf-8"))
            return "headless" in str(info.get("Browser", "")).lower()
        except Exception:
            return False
    return "--headless" in _instance_command(pid)


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
        return False, "当前平台不支持自动切前台，请手动切到 9222 浏览器窗口"
    if not _foreground_allowed():
        # 非交互式（后台/定时/Hermes）运行：静默跳过切前台，调用方仍会抛出登录错误。
        _debug_log("bring_chrome_to_front.skip", reason="foreground_not_allowed")
        return False, "非交互式运行，跳过切前台（避免后台弹窗）"
    pid = _instance_pid()
    if pid is None:
        _debug_log("bring_chrome_to_front.skip", reason="no_pid")
        return False, "未找到专用 9222 Chrome 实例，跳过切前台"
    ok = _system_events(
        f"tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to true",
        f"tell application \"System Events\" to set frontmost of (first process whose unix id is {pid}) to true",
    )
    if ok:
        _debug_log("bring_chrome_to_front.ok", pid=pid)
        return True, "已将专用 9222 Chrome 切到前台"
    _debug_log("bring_chrome_to_front.failed", pid=pid)
    return False, "切换专用 9222 Chrome 到前台失败"


def hide_chrome(*, max_wait_seconds: float = 2.0, poll_interval: float = 0.1) -> tuple[bool, str]:
    _debug_log("hide_chrome.enter")
    if not IS_MACOS:
        _debug_log("hide_chrome.skip", reason="not_macos")
        return False, "当前平台不支持自动隐藏窗口"
    pid = _instance_pid()
    if pid is None:
        # 找不到专用实例时什么都不做，避免误伤用户日常 Chrome。
        _debug_log("hide_chrome.skip", reason="no_pid")
        return False, "未找到专用 9222 Chrome 实例，跳过隐藏"
    ok = _system_events(
        f"tell application \"System Events\" to set visible of (first process whose unix id is {pid}) to false",
    )
    if ok and _wait_until_hidden(pid, max_wait_seconds=max_wait_seconds, poll_interval=poll_interval):
        _debug_log("hide_chrome.ok", pid=pid)
        return True, "已将专用 9222 Chrome 隐藏到后台"
    if ok:
        _debug_log("hide_chrome.unconfirmed", pid=pid)
        return False, "隐藏专用 9222 Chrome 命令已发送，但未确认隐藏"
    _debug_log("hide_chrome.failed", pid=pid)
    return False, "隐藏专用 9222 Chrome 失败"


def surface_for_login(reason: str) -> None:
    """统一的「需要登录」出口：把专用 9222 Chrome 切到前台让用户手动登录，并抛错中断。

    这是 9222 浏览器唯一允许主动弹窗的场景。其余自动化行为一律静默（后台运行）。
    """
    _debug_log("surface_for_login", reason=reason)
    bring_chrome_to_front()
    raise RuntimeError(reason)


def stop_chrome() -> tuple[bool, str]:
    if IS_WINDOWS:
        pid = _instance_pid_windows()
        if pid is None:
            return True, "未找到专用 Chrome，无需关闭"
        # /T 连子进程一起结束；Windows 的 os.kill 没有 SIGKILL 可用。
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
        for _ in range(20):
            if not is_port_open():
                return True, "已关闭专用 Chrome"
            time.sleep(0.25)
        return True, "已强制关闭专用 Chrome"
    try:
        result = subprocess.run(
            ["pgrep", "-f", str(PROFILE_DIR)],
            text=True,
            capture_output=True,
            check=False,
        )
    except Exception as exc:
        return False, f"查找专用 Chrome 失败：{exc}"
    pids = []
    for line in result.stdout.splitlines():
        try:
            pid = int(line.strip())
        except ValueError:
            continue
        if pid != os.getpid():
            pids.append(pid)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(20):
        if not is_port_open():
            return True, "已关闭专用 Chrome"
        time.sleep(0.25)
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    return True, "已强制关闭专用 Chrome"


def start_chrome(force: bool = False, *, foreground: bool = False, headless: bool = False) -> tuple[bool, str]:
    _debug_log("start_chrome.enter", force=force, foreground=foreground, headless=headless)
    ok, msg = check_cdp()
    if ok and not force:
        pid = _instance_pid()
        if headless and pid is not None and not _instance_is_headless(pid):
            _debug_log("start_chrome.restart_for_headless", pid=pid)
            stop_chrome()
            ok = False
        elif (
            not headless
            and pid is not None
            and _instance_is_headless(pid)
            and (foreground or _foreground_allowed())
        ):
            _debug_log("start_chrome.restart_for_headful_foreground", pid=pid)
            stop_chrome()
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
    if force:
        stop_chrome()
    if not CHROME_BIN.exists():
        return False, f"找不到 Chrome：{CHROME_BIN}"
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    # 默认无头：真正要新拉起实例时，若无人坐在终端前（Hermes/后台/workflow 子进程）
    # 且未显式要求前台，则无头静默启动，避免后台自动化（含截图时的 bring_to_front）
    # 把 9222 窗口弹到前台打扰。想看浏览器时双击桌面「Google Chrome 9222.app」会杀掉
    # 无头实例并拉起可见窗口。注意：此处只影响“新拉起”，不会动已在运行的可见实例。
    if not headless and not foreground and not _foreground_allowed():
        headless = True
        _debug_log("start_chrome.default_headless", reason="no_tty_background")
    if headless:
        launch_cmd = [
            str(CHROME_BIN),
            "--headless=new",
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-gpu",
            "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
            # 固定离屏视口，保证 fund 资金表等凭证截图尺寸稳定、内容不被裁切。
            "--window-size=1440,900",
            "about:blank",
        ]
    elif IS_MACOS:
        # -g 后台打开，不抢前台；-na 强制新实例并透传 --args。
        launch_cmd = [
            "/usr/bin/open",
            "-g",
            "-na",
            CHROME_APP_NAME,
            "--args",
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window",
            "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
            "about:blank",
        ]
    else:
        # Windows / Linux 没有 `open`，直接执行 Chrome 可执行文件。
        launch_cmd = [
            str(CHROME_BIN),
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window",
            "--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationHints",
            "about:blank",
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
    return False, f"已尝试启动 Chrome，但 CDP 仍不可用。也可以手动运行：\n{chrome_start_command()}"
