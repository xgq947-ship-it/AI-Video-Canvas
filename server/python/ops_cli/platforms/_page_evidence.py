"""生成等待失败时的现场取证。

为什么需要它：平台侧明明已经出图（用户能在即梦历史里看到 4 张），我们却只能报
「等待超过 10 分钟，无法确认任务最终状态」。事后没有任何现场，谁也说不清当时页面
到底长什么样 —— 是被别的任务换掉了、结果渲染在别的容器里、还是真的在排队。
每次这类失败都必须留下可复盘的证据，否则同一个问题只能靠猜。

取证是**只读**的：截图、抓 DOM、读文本。绝不点击任何按钮 —— 等待失败时任务已经
提交、配额已经扣掉，任何点击都可能触发二次生成。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from ops_cli.config import get_config


MAX_HTML_CHARS = 400_000
MAX_TEXT_CHARS = 4_000


def _evidence_root() -> Path:
    return Path(get_config().runtime_dir) / "evidence"


def _safe(action, default=None):
    try:
        return action()
    except Exception:
        return default


def image_probe_counts(page: Any, container_selector: str | None = None) -> dict[str, int]:
    """按「筛选阶段」统计 img，用来定位结果图到底被哪一层条件挡掉了。

    等待逻辑要求 http 前缀 + 原始尺寸 ≥256 + 渲染尺寸 ≥96。只报「没找到图」无法区分
    「页面上根本没有 img」和「有图但被某一条筛掉了」，这两种的修法完全不同。
    """
    script = """
    selector => {
      const root = selector ? document.querySelector(selector) : document;
      const nodes = root ? Array.from(root.querySelectorAll('img')) : [];
      const info = nodes.map(el => {
        const box = el.getBoundingClientRect();
        return {
          http: (el.currentSrc || el.src || '').startsWith('http'),
          natural: (el.naturalWidth || 0) >= 256 && (el.naturalHeight || 0) >= 256,
          rendered: (box.width || 0) >= 96 && (box.height || 0) >= 96,
        };
      });
      return {
        total: info.length,
        http: info.filter(i => i.http).length,
        naturalOk: info.filter(i => i.http && i.natural).length,
        renderedOk: info.filter(i => i.http && i.natural && i.rendered).length,
      };
    }
    """
    return _safe(lambda: page.evaluate(script, container_selector), {}) or {}


def capture_page_evidence(
    page: Any,
    *,
    scene: str,
    reason: str,
    container_selector: str | None = None,
    extra: dict[str, Any] | None = None,
) -> str | None:
    """把当前页面现场落到 runtime/evidence/<scene>_<时间戳>/，返回目录路径。

    取证本身失败绝不能盖掉真正的错误，所以每一步都单独兜底，最后返回 None。
    """
    try:
        directory = _evidence_root() / f"{scene}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        directory.mkdir(parents=True, exist_ok=True)
    except Exception:
        return None

    closed = _safe(page.is_closed, None)
    meta: dict[str, Any] = {
        "scene": scene,
        "reason": reason,
        "captured_at": datetime.now().isoformat(timespec="seconds"),
        "page_closed": closed,
        "url": _safe(lambda: str(page.url), ""),
        "title": _safe(page.title, ""),
        "image_counts": {} if closed else image_probe_counts(page, container_selector),
        "container_selector": container_selector,
        "container_found": _safe(
            lambda: bool(container_selector) and page.locator(container_selector).count() > 0,
            None,
        ),
        **(extra or {}),
    }

    if not closed:
        _safe(lambda: page.screenshot(path=str(directory / "page.png"), full_page=False, timeout=20_000))
        html = _safe(lambda: page.content(), "") or ""
        if html:
            _safe(lambda: (directory / "page.html").write_text(html[:MAX_HTML_CHARS], encoding="utf-8"))
        text = _safe(lambda: page.locator("body").inner_text(timeout=5_000), "") or ""
        if text:
            _safe(lambda: (directory / "page.txt").write_text(text[:MAX_TEXT_CHARS], encoding="utf-8"))

    _safe(lambda: (directory / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    ))
    return str(directory)
