"""即梦图片 5.0 生图 provider（text-to-image 能力）。

通过 Evan 专属 Chrome 驱动即梦「图片生成」页面，不调用未公开 API。登录恢复、composer、
参考素材上传、提示词写入与通用媒体下载复用即梦视频 provider 已验证的页面基座。

当前只开放画板需要的两个模型：图片 5.0 Pro、图片 5.0 Lite。
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ops_cli.output import CommandResponse
from ops_cli.browser import managed_work_page
from ops_cli.platforms._google_flow_common import (
    _download_media as _download_media_url,
    _import_browser_runtime,
)
from ops_cli.platforms._page_evidence import capture_page_evidence
from ops_cli.platforms.image_to_video.providers.jimeng import (
    CREDITS_MARKERS,
    FAILURE_MARKERS,
    FATAL_PAGE_MARKERS,
    FIELD_ASPECT_RATIO,
    FIELD_COUNT,
    FIELD_RESOLUTION,
    JIMENG_HOST,
    MAX_CONSECUTIVE_PAGE_READ_ERRORS,
    REJECTION_MARKERS,
    JimengError,
    _composer_image_count,
    _close_transient_popovers,
    _ensure_result_delivery,
    _ensure_composer,
    _fill_prompt,
    _matched_line,
    _pick_radio,
    _queue_hint,
    _result_area_text,
    _submit,
)


JIMENG_IMAGE_SCENE = "jimeng/image_generate"
DEFAULT_GENERATE_URL = "https://jimeng.jianying.com/ai-tool/generate?type=image"
DEFAULT_MODEL = "图片 5.0 Lite"
DEFAULT_ASPECT_RATIO = "1:1"
DEFAULT_RESOLUTION = "2K"
DEFAULT_COUNT = 1
SUPPORTED_MODELS = ("图片 5.0 Pro", "图片 5.0 Lite")
SUPPORTED_ASPECT_RATIOS = ("21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16")
SUPPORTED_RESOLUTIONS = ("2K", "4K")
SUPPORTED_COUNTS = tuple(range(1, 5))
MAX_REFERENCE_IMAGES = 12
CREATION_TYPE_IMAGE = "图片生成"
TOOLBAR_SELECT = ".lv-select[class*='toolbar-select']"
TOOLBAR_BUTTON = "button[class*='toolbar-button']"
_RESOLUTION_LABELS = {"2K": "高清 2K", "4K": "超清 4K"}
_IGNORED_IMAGE_URL_PATTERNS = (
    "user-avatar",
    "passport.byteacctimg.com",
    "/common/images/",
    "favicon",
    "avatar",
)
_IMAGE_REFERENCE_TAG = re.compile(r"@(?P<label>(?:参考图|图片)\s*(?P<index>\d+))")
_DOWNLOAD_CONTROL_RE = re.compile(r"下载|download", re.I)
_ORIGINAL_DOWNLOAD_OPTION_RE = re.compile(
    r"下载原图|原图下载|无水印|完整尺寸|高清原图|超清原图|"
    r"download original|download full size|original",
    re.I,
)
_THUMBNAIL_URL_RE = re.compile(r"(?:~|%7e)resize[:%3a_-]*\d+", re.I)


def _default_output_dir() -> Path:
    return Path.home() / "Desktop" / "即梦图片生成"


def _prompt_for_image_composer(prompt: str, reference_count: int) -> str:
    """把画板的 @参考图N 标签转成即梦图片模式可提交的普通文本。

    即梦视频模式需要真正的 @mention；图片模式则由上传缩略图直接绑定参考素材，
    字面 ``@参考图1`` 不会变成 mention，反而会让提交按钮保持 disabled。
    """
    if reference_count <= 0:
        return prompt

    def replace(match: re.Match[str]) -> str:
        index = int(match.group("index"))
        return match.group("label") if 1 <= index <= reference_count else match.group(0)

    return _IMAGE_REFERENCE_TAG.sub(replace, prompt)


def _generate_url() -> str:
    return os.environ.get("JIMENG_IMAGE_GENERATE_URL", "").strip() or DEFAULT_GENERATE_URL


def _existing_jimeng_page(context: Any) -> Any | None:
    """优先复用即梦标签页，避免 Chromium 在已有页面较多时创建新 target 卡住。"""
    for page in reversed(list(getattr(context, "pages", []) or [])):
        try:
            if not page.is_closed() and JIMENG_HOST in (page.url or ""):
                return page
        except Exception:
            continue
    return None


def _validate_inputs(
    *,
    prompt: str,
    reference_images: list[str],
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    timeout_minutes: int,
) -> tuple[str, list[Path], str, str]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise JimengError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空。")
    if aspect_ratio not in SUPPORTED_ASPECT_RATIOS:
        raise JimengError(
            "ASPECT_RATIO_NOT_SUPPORTED",
            f"--aspect-ratio 只支持 {'、'.join(SUPPORTED_ASPECT_RATIOS)}。",
        )
    normalized_resolution = str(resolution or "").strip().upper()
    if normalized_resolution not in SUPPORTED_RESOLUTIONS:
        raise JimengError(
            "RESOLUTION_NOT_SUPPORTED",
            f"--resolution 只支持 {'、'.join(SUPPORTED_RESOLUTIONS)}。",
        )
    if count not in SUPPORTED_COUNTS:
        raise JimengError("COUNT_NOT_SUPPORTED", "--count 只支持 1-4。")
    normalized_model = str(model or "").strip()
    if normalized_model not in SUPPORTED_MODELS:
        raise JimengError(
            "MODEL_NOT_SUPPORTED",
            f"--model 只支持 {'、'.join(SUPPORTED_MODELS)}。",
        )
    if timeout_minutes <= 0:
        raise JimengError("GENERATION_TIMEOUT", "--timeout-minutes 必须大于 0。")

    reference_paths: list[Path] = []
    for raw in reference_images or []:
        ref = Path(str(raw)).expanduser().resolve()
        if not ref.is_file():
            raise JimengError("REFERENCE_IMAGE_NOT_FOUND", f"参考图不存在：{ref}")
        reference_paths.append(ref)
    if len(reference_paths) > MAX_REFERENCE_IMAGES:
        raise JimengError(
            "REFERENCE_IMAGE_ADD_FAILED",
            f"即梦图片生成最多接收 {MAX_REFERENCE_IMAGES} 张参考图，当前 {len(reference_paths)} 张。",
        )
    return normalized_prompt, reference_paths, normalized_resolution, normalized_model


def _response_data(
    *,
    prompt: str,
    reference_images: list[Path],
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    output_dir: Path,
    dry_run: bool,
    execute: bool,
    images: list[dict[str, str | None]] | None = None,
    screenshot_path: str | None = None,
) -> dict[str, Any]:
    images = images or []
    return {
        "prompt": prompt,
        "reference_images": [str(ref) for ref in reference_images],
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "count": count,
        "model": model,
        "output_dir": str(output_dir),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "images": images,
        "screenshot_path": screenshot_path,
        "source": "preview" if dry_run or not execute else "page",
        "scene": JIMENG_IMAGE_SCENE,
        "artifacts": [
            artifact
            for artifact in ([item.get("path") for item in images] + [screenshot_path])
            if artifact
        ],
    }


def _visible_toolbar_selects(page: Any) -> list[Any]:
    selects = page.locator(TOOLBAR_SELECT)
    return [selects.nth(index) for index in range(selects.count()) if selects.nth(index).is_visible()]


def _select_creation_type(page: Any) -> None:
    select = next(
        (
            node
            for node in _visible_toolbar_selects(page)
            if "生成" in (node.inner_text() or "")
        ),
        None,
    )
    if select is None:
        raise JimengError("PAGE_NAVIGATION_FAILED", "未找到即梦创作类型下拉框。")
    if (select.inner_text() or "").strip() == CREATION_TYPE_IMAGE:
        return
    select.click()
    page.wait_for_timeout(600)
    from ops_cli.platforms.image_to_video.providers.jimeng import _choose_option

    _choose_option(page, CREATION_TYPE_IMAGE, error_code="PAGE_NAVIGATION_FAILED")


def _select_model(page: Any, model: str) -> None:
    select = next(
        (
            node
            for node in _visible_toolbar_selects(page)
            if (node.inner_text() or "").strip() != CREATION_TYPE_IMAGE
            and (node.inner_text() or "").strip().startswith("图片 ")
        ),
        None,
    )
    if select is None:
        raise JimengError("MODEL_NOT_FOUND", "未找到即梦图片模型下拉框。")
    if (select.inner_text() or "").strip() == model:
        return
    select.click()
    page.wait_for_timeout(700)
    from ops_cli.platforms.image_to_video.providers.jimeng import _choose_option

    _choose_option(page, model, error_code="MODEL_NOT_FOUND")


def _output_settings_button(page: Any) -> Any | None:
    buttons = page.locator(TOOLBAR_BUTTON)
    for index in range(buttons.count()):
        node = buttons.nth(index)
        try:
            text = (node.inner_text() or "").strip()
            if node.is_visible() and ("智能比例" in text or ":" in text):
                return node
        except Exception:
            continue
    return None


def _configure_output(page: Any, *, aspect_ratio: str, resolution: str, count: int) -> None:
    button = _output_settings_button(page)
    if button is None:
        raise JimengError("PAGE_NAVIGATION_FAILED", "未找到即梦图片比例/分辨率/数量设置按钮。")
    button.click()
    page.wait_for_timeout(700)
    try:
        _pick_radio(
            page,
            title=FIELD_ASPECT_RATIO,
            value=aspect_ratio,
            error_code="ASPECT_RATIO_NOT_SUPPORTED",
            required=True,
        )
        _pick_radio(
            page,
            title=FIELD_RESOLUTION,
            value=_RESOLUTION_LABELS[resolution],
            error_code="RESOLUTION_NOT_SUPPORTED",
            required=True,
        )
        _pick_radio(
            page,
            title=FIELD_COUNT,
            value=str(count),
            error_code="COUNT_NOT_SUPPORTED",
            required=True,
        )
    finally:
        _close_transient_popovers(page, trigger=button)


def _attach_reference_images(page: Any, reference_paths: list[Path]) -> None:
    """上传图片参考素材。

    图片模式把上传缩略图直接作为参考，不要求像视频模式那样给素材重命名并在提示词里
    建立 @mention。逐张上传并等待缩略图出现，保证提交前素材确实到达 composer。
    """
    if not reference_paths:
        return
    file_input = page.locator("input[type=file]").first
    if file_input.count() == 0:
        raise JimengError("REFERENCE_IMAGE_ADD_FAILED", "未找到即梦图片参考图上传入口。")
    for index, reference_path in enumerate(reference_paths, start=1):
        baseline = max(_composer_image_count(page), 0)
        try:
            file_input.set_input_files(str(reference_path))
        except Exception as exc:
            raise JimengError(
                "REFERENCE_IMAGE_ADD_FAILED",
                f"上传第 {index} 张参考图失败：{exc}",
                retryable=True,
            ) from exc
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if _composer_image_count(page) > baseline:
                break
            page.wait_for_timeout(1500)
        else:
            raise JimengError(
                "REFERENCE_IMAGE_ADD_FAILED",
                f"第 {index} 张参考图 3 分钟内未上传完成。",
                retryable=True,
            )


RESULT_AREA_SELECTOR = "[class*='record-list']"


def _page_disturbed(page: Any) -> str:
    """等待期间工作页是否被换掉了。

    实测事故：识图任务当时没有进队列，用户在生成刚提交时点了「打开 Evan 专属 Chrome」
    与「检查登录状态」，这两个动作会重启 / 停掉 Chrome。即梦那边照常出图（历史里 4 张
    都在），我们这边的页却已经不是那一页了，于是空轮询满 10 分钟才报「无法确认」。
    页没了就立刻说清楚，不要再干等十分钟。
    """
    # 只认**确定**的信号。读不到状态不等于页面没了：那可能只是一次抖动，
    # 而这时候误判会直接放弃一次已经扣过积分的生成。真正读不动的页面由
    # 既有的「连续读取失败」计数兜底。
    if _safe_call(lambda: page.is_closed()) is True:
        return "工作页在生成期间被关闭"
    host = _safe_call(lambda: (urlparse(str(page.url or "")).hostname or "").lower())
    if host and JIMENG_HOST not in host:
        return f"工作页在生成期间被导航到了 {host}"
    return ""


def _safe_call(action: Any) -> Any:
    try:
        return action()
    except Exception:
        return None


def _image_urls(page: Any) -> list[str]:
    # 只从主结果记录区取图。上传参考图后，composer 缩略图会先用 blob:，提交后再
    # 换成带签名的 http URL；若扫描整页，它会被误判成新结果，导致参考图单张返回
    # 原图、参考图多张在第 2 张仍生成时提前成功。
    #
    # 尺寸判据必须按**长边**，不能要求两边都 ≥256。即梦结果区缩略图统一按长边 360
    # 渲染：1:1 是 360×360 两边都过，而 16:9 是 360×202 —— 短边 202 被卡掉，
    # 于是 16:9 的结果一张也收不到，只能空等到超时。本机现场实测（evidence
    # jimeng_image_wait_timeout_20260727_072406）：结果区 5 张 img 里 4 张真结果
    # 全是 360×202、渲染 238×134，旧规则命中 0 张。
    # 短边下限 96 与「渲染长边 ≥96」用来挡掉侧栏会话缩略图（100×56）和 composer
    # 里的小预览（360×360 但只渲染 42×53）。
    result_area = page.locator(RESULT_AREA_SELECTOR)
    root = result_area.first if result_area.count() > 0 else page
    candidates = root.locator("img").evaluate_all(
        """els => {
          const imageUrl = value => {
            try {
              const url = new URL(value, location.href);
              return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
            } catch {
              return '';
            }
          };
          const bestSource = el => {
            const choices = [];
            const add = (value, score) => {
              const url = imageUrl(value);
              if (url) choices.push({url, score});
            };
            add(el.currentSrc || el.src || '', 0);
            for (const candidate of (el.getAttribute('srcset') || '').split(',')) {
              const match = candidate.trim().match(/^(\\S+)(?:\\s+(\\d+(?:\\.\\d+)?)(w|x))?$/);
              if (match) add(match[1], match[3] === 'w'
                ? Number(match[2] || 0)
                : Number(match[2] || 0) * 1000);
            }
            const originalAttrs = [
              'data-original', 'data-original-src', 'data-origin-src',
              'data-full-src', 'data-full-url', 'data-download-url',
            ];
            for (const attr of originalAttrs) add(el.getAttribute(attr) || '', 100000);
            let ancestor = el;
            for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
              for (const attr of originalAttrs) add(ancestor.getAttribute?.(attr) || '', 90000 - depth);
              if (ancestor instanceof HTMLAnchorElement) add(ancestor.href || '', 80000 - depth);
            }
            choices.sort((a, b) => b.score - a.score);
            return choices[0]?.url || '';
          };
          return els.map(el => ({
             src: bestSource(el),
             width: el.naturalWidth || 0,
             height: el.naturalHeight || 0,
             renderedWidth: el.getBoundingClientRect().width || 0,
             renderedHeight: el.getBoundingClientRect().height || 0,
           }))
           .filter(item => item.src.startsWith('http')
             && Math.max(item.width, item.height) >= 256
             && Math.min(item.width, item.height) >= 96
             && Math.max(item.renderedWidth, item.renderedHeight) >= 96)
           .map(item => item.src);
        }"""
    )
    return [
        url
        for url in candidates
        if not any(pattern in url.lower() for pattern in _IGNORED_IMAGE_URL_PATTERNS)
    ]


def _image_identity(url: str) -> str:
    """把同一即梦结果的多 CDN/签名 URL 归并为一个媒体身份。

    页面会为同一张图同时渲染 p11/p26 两个 byteimg 地址，host、签名和尺寸参数不同，
    但 path 中的媒体 UUID 相同。按完整 URL 去重会让 count=2 提前返回两份相同文件。
    """
    parsed = urlparse(str(url or ""))
    # 同一媒体的缩略图、srcset 大图和下载原图可能只在 ``~resize:*`` 变换后缀上不同。
    # 去掉变换后缀后再比较，才能既去重 CDN 副本，也能把高清资源定位回对应结果卡片。
    path = parsed.path.split("~", 1)[0]
    return path or str(url or "")


def _control_label(control: Any) -> str:
    parts: list[str] = []
    for attribute in ("aria-label", "title", "data-tooltip"):
        try:
            parts.append(str(control.get_attribute(attribute) or ""))
        except Exception:
            pass
    try:
        parts.append(str(control.inner_text(timeout=1000) or ""))
    except Exception:
        pass
    return " ".join(parts).strip()


def _visible_download_controls(scope: Any, pattern: re.Pattern[str]) -> list[Any]:
    try:
        controls = scope.locator("button, [role='button'], [role='menuitem'], a[download]")
    except Exception:
        return []
    matches: list[Any] = []
    for index in range(controls.count()):
        control = controls.nth(index)
        try:
            if control.is_visible() and pattern.search(_control_label(control)):
                matches.append(control)
        except Exception:
            continue
    return matches


def _result_image_locator(page: Any, image_url: str) -> Any | None:
    """按媒体身份把高清候选 URL 定位回自己的结果卡片缩略图。"""
    target_identity = _image_identity(image_url)
    result_area = page.locator(RESULT_AREA_SELECTOR)
    root = result_area.first if result_area.count() > 0 else page
    images = root.locator("img")
    for index in range(images.count()):
        image = images.nth(index)
        try:
            current_url = image.evaluate("el => el.currentSrc || el.src || ''")
            if _image_identity(current_url) == target_identity:
                return image
        except Exception:
            continue
    return None


def _save_browser_download(download: Any, output_dir: Path, filename_stem: str) -> str | None:
    try:
        suffix = Path(str(download.suggested_filename or "")).suffix or ".png"
        destination = output_dir / f"{filename_stem}{suffix}"
        download.save_as(str(destination))
        if destination.is_file() and destination.stat().st_size > 0:
            return str(destination)
    except Exception:
        pass
    return None


def _click_for_original_download(
    page: Any, image_url: str, output_dir: Path, filename_stem: str
) -> str | None:
    """悬停指定结果卡片并下载它自己的原图，避免多图时反复点到最后一张。"""
    image = _result_image_locator(page, image_url)
    if image is None:
        return None
    try:
        image.scroll_into_view_if_needed(timeout=5000)
        image.hover(timeout=5000)
        page.wait_for_timeout(300)
    except Exception:
        return None

    # 工具栏通常位于图片上方若干层祖先中；从最小卡片向外找，避免命中别的结果。
    scopes: list[Any] = []
    scope = image
    for _depth in range(7):
        try:
            scope = scope.locator("xpath=..")
            scopes.append(scope)
        except Exception:
            break
    scopes.append(page)

    control = next(
        (
            candidate
            for candidate_scope in scopes
            for candidate in _visible_download_controls(candidate_scope, _DOWNLOAD_CONTROL_RE)
        ),
        None,
    )
    if control is None:
        return None

    try:
        with page.expect_download(timeout=5000) as download_info:
            control.click()
        saved = _save_browser_download(download_info.value, output_dir, filename_stem)
        if saved:
            return saved
    except Exception:
        # 即梦有时先弹出「下载原图/无水印」菜单；第一次点击已负责打开菜单。
        pass

    options = _visible_download_controls(page, _ORIGINAL_DOWNLOAD_OPTION_RE)
    for option in options:
        try:
            with page.expect_download(timeout=15_000) as download_info:
                option.click()
            saved = _save_browser_download(download_info.value, output_dir, filename_stem)
            if saved:
                return saved
        except Exception:
            continue
    return None


def _download_jimeng_image(
    page: Any, image_url: str, output_dir: Path, stamp: str
) -> str | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename_stem = f"jimeng_img_{stamp}"
    original = _click_for_original_download(page, image_url, output_dir, filename_stem)
    if original:
        return original

    # srcset/data-original 已经给出高清直链时允许 HTTP 回退；明确的 resize:360 缩略图
    # 不能再被当作成功结果，否则用户选择 2K/4K 最终仍只得到 360px 文件。
    if _THUMBNAIL_URL_RE.search(image_url):
        return None
    return _download_media_url(
        page,
        image_url,
        output_dir,
        stamp,
        prefix="jimeng_img_",
        default_ext=".png",
    )


def _wait_for_images(
    page: Any,
    *,
    previous_urls: set[str],
    expected: int,
    timeout_minutes: int,
) -> list[str]:
    deadline = time.monotonic() + timeout_minutes * 60
    collected: list[str] = []
    previous_identities = {_image_identity(url) for url in previous_urls}
    collected_identities: set[str] = set()
    consecutive_read_errors = 0
    queue_message = ""
    while time.monotonic() < deadline:
        try:
            disturbed = _page_disturbed(page)
            if disturbed:
                raise JimengError(
                    "SUBMISSION_UNKNOWN",
                    f"生成已提交，但{disturbed}，无法在原页面确认结果。",
                    retryable=False,
                    recovery_hint=(
                        "生成期间不要打开浏览器窗口或检查登录状态（会重启 Chrome）。"
                        "结果可能已经产出，请先在即梦历史会话中确认，避免重复消耗积分。"
                    ),
                )
            page_text = _result_area_text(page)
            queue_message = _queue_hint(page_text) or queue_message
            for marker in CREDITS_MARKERS:
                if marker in page_text:
                    raise JimengError("JIMENG_CREDITS_INSUFFICIENT", f"即梦积分不足（页面提示：{marker}）。")
            for marker in REJECTION_MARKERS:
                if marker in page_text:
                    raise JimengError(
                        "JIMENG_CONTENT_REJECTED",
                        f"即梦拒绝了本次素材/内容（页面提示：{_matched_line(page_text, marker) or marker}）。",
                        retryable=False,
                        recovery_hint="请更换参考图或调整提示词后重试。",
                    )
            for marker in FAILURE_MARKERS:
                if marker in page_text:
                    raise JimengError(
                        "JIMENG_GENERATION_FAILED",
                        f"即梦已明确返回生成失败（页面提示：{marker}）。",
                        retryable=True,
                    )
            for url in _image_urls(page):
                identity = _image_identity(url)
                if identity in previous_identities or identity in collected_identities:
                    continue
                collected_identities.add(identity)
                collected.append(url)
            if len(collected) >= expected:
                return collected[:expected]
            consecutive_read_errors = 0
            page.wait_for_timeout(2500)
        except JimengError:
            raise
        except Exception as exc:
            if any(marker in str(exc) for marker in FATAL_PAGE_MARKERS):
                raise JimengError(
                    "SUBMISSION_UNKNOWN",
                    "等待图片结果期间，Evan 专属 Chrome 或即梦标签页被关闭了。",
                    retryable=False,
                    recovery_hint="任务可能已提交，请先在即梦历史会话中确认，避免重复扣积分。",
                ) from exc
            consecutive_read_errors += 1
            if consecutive_read_errors >= MAX_CONSECUTIVE_PAGE_READ_ERRORS:
                raise JimengError(
                    "SUBMISSION_UNKNOWN",
                    f"图片生成期间连续 {consecutive_read_errors} 次读取即梦页面失败：{exc}",
                    retryable=False,
                    recovery_hint=(
                        "图片生成请求已经提交，请先在即梦历史会话中确认结果，"
                        "避免直接重试造成重复生成和积分消耗。"
                    ),
                ) from exc
            time.sleep(2)
    detail = f"页面提示：{queue_message}。" if queue_message else ""
    # 超时是最难复盘的一类：平台可能已经出图，而我们只知道「没等到」。先把现场落盘
    # （截图 + DOM + 各级筛选下的 img 计数），否则下次遇到还是只能靠猜。
    evidence = capture_page_evidence(
        page,
        scene="jimeng_image_wait_timeout",
        reason=f"等待 {timeout_minutes} 分钟未收到 {expected} 张结果",
        container_selector=RESULT_AREA_SELECTOR,
        extra={"collected": len(collected), "expected": expected, "queue_message": queue_message},
    )
    raise JimengError(
        "SUBMISSION_UNKNOWN",
        f"等待即梦图片生成超过 {timeout_minutes} 分钟，无法确认任务最终状态。{detail}",
        retryable=False,
        recovery_hint=(
            "图片生成请求已经提交，请先在即梦历史会话中确认结果；"
            "确认没有任务后再重新生成，避免重复消耗积分。"
            + (f"现场记录：{evidence}" if evidence else "")
        ),
    )


def _deliver_results(
    page: Any, image_urls: list[str], output_dir: Path
) -> tuple[list[dict[str, str | None]], str | None]:
    """下载结果并落盘。等待成功与超时后补收共用，避免两条路径的产物格式漂移。"""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    images: list[dict[str, str | None]] = []
    for index, url in enumerate(image_urls, start=1):
        saved = _download_jimeng_image(page, url, output_dir, f"{stamp}_{index}")
        images.append({"path": saved, "url": url})
    _ensure_result_delivery(images, error_code="IMAGE_DOWNLOAD_FAILED", media_label="图片")
    screenshot = output_dir / f"jimeng_img_{stamp}.png"
    try:
        page.screenshot(path=str(screenshot), full_page=False, timeout=30_000)
        return images, str(screenshot)
    except Exception:
        return images, None


def _reclaim_images(
    page: Any,
    *,
    previous_urls: set[str],
    expected: int,
    wait_seconds: int = 60,
) -> list[str]:
    """在一张全新的工作页上只读补收已经产出的结果。

    等待失败不代表没生成 —— 实测事故里即梦已经出了 4 张图，只是我们那一页被别的
    动作换掉了，白白丢掉一次已扣积分的结果。这里重新打开生成页、按和等待时完全
    相同的规则扫描结果区，把不在提交前快照里的图收回来。

    **严格只读**：只做 goto / 读 DOM / 下载。绝不点「再次生成」之类的按钮 ——
    任务已经提交过，任何点击都可能造成二次生成和重复扣费。
    """
    try:
        page.goto(_generate_url(), wait_until="domcontentloaded", timeout=60_000)
    except Exception:
        return []
    previous_identities = {_image_identity(url) for url in previous_urls}
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        found: list[str] = []
        seen: set[str] = set()
        try:
            for url in _image_urls(page):
                identity = _image_identity(url)
                if identity in previous_identities or identity in seen:
                    continue
                seen.add(identity)
                found.append(url)
        except Exception:
            found = []
        if len(found) >= expected:
            return found[:expected]
        page.wait_for_timeout(3000)
    return []


def _execute_generation(
    *,
    prompt: str,
    reference_paths: list[Path],
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    output_dir: Path,
    timeout_minutes: int,
) -> tuple[list[dict[str, str | None]], str | None]:
    cdp_url, PlaywrightError, PlaywrightTimeoutError, sync_playwright = _import_browser_runtime()
    # 提交阶段标记：提交之前失败可以安全重试，提交之后不行（配额已经花掉）。
    submitted = False
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            with managed_work_page(context, "jimeng.image.generate", cleanup_before=True) as page:
                try:
                    page.goto(_generate_url(), wait_until="domcontentloaded", timeout=60_000)
                except (PlaywrightError, PlaywrightTimeoutError) as exc:
                    raise JimengError(
                        "PAGE_NAVIGATION_FAILED",
                        f"打开即梦图片生成页失败：{exc}",
                        retryable=True,
                    ) from exc
                _ensure_composer(page)
                _select_creation_type(page)
                _select_model(page, model)
                _configure_output(
                    page,
                    aspect_ratio=aspect_ratio,
                    resolution=resolution,
                    count=count,
                )
                _attach_reference_images(page, reference_paths)
                _fill_prompt(page, _prompt_for_image_composer(prompt, len(reference_paths)))

                previous_urls = set(_image_urls(page))
                # 从这一行往后，平台已经开始扣配额。任何后续失败都必须带上
                # submitted=True，上层据此拒绝重试，避免二次提交、重复扣费。
                _submit(page)
                submitted = True
                try:
                    image_urls = _wait_for_images(
                        page,
                        previous_urls=previous_urls,
                        expected=count,
                        timeout_minutes=timeout_minutes,
                    )
                except JimengError as wait_error:
                    # 「没等到」不等于「没生成」。积分已经扣了，先去新页面只读补收一次，
                    # 收得到就正常交付；收不到再把原始错误抛出去，绝不自动重新提交。
                    if wait_error.error_code != "SUBMISSION_UNKNOWN":
                        raise
                    with managed_work_page(
                        context, "jimeng.image.reclaim", cleanup_before=False
                    ) as reclaim_page:
                        image_urls = _reclaim_images(
                            reclaim_page, previous_urls=previous_urls, expected=count
                        )
                        if not image_urls:
                            raise
                        return _deliver_results(reclaim_page, image_urls, output_dir)

                return _deliver_results(page, image_urls, output_dir)
    except JimengError as exc:
        # 提交后抛出的结构化错误同样要打上标记（下载失败、等待超时等）。
        if submitted:
            exc.submitted = True
        raise
    except Exception as exc:
        raise JimengError(
            "PAGE_NAVIGATION_FAILED",
            f"即梦图片页面自动化失败：{exc}",
            retryable=True,
            submitted=submitted,
        ) from exc


def run_image_generate(
    *,
    prompt: str,
    reference_images: list[str] | None = None,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    resolution: str = DEFAULT_RESOLUTION,
    count: int = DEFAULT_COUNT,
    model: str = DEFAULT_MODEL,
    output_dir: str | None = None,
    timeout_minutes: int = 10,
    dry_run: bool = False,
    execute: bool = False,
) -> CommandResponse:
    normalized_prompt, reference_paths, normalized_resolution, normalized_model = _validate_inputs(
        prompt=prompt,
        reference_images=reference_images or [],
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        count=count,
        model=model,
        timeout_minutes=timeout_minutes,
    )
    resolved_output_dir = Path(output_dir).expanduser().resolve() if output_dir else _default_output_dir()

    if dry_run or not execute:
        return CommandResponse(
            success=True,
            platform="jimeng",
            command="text-to-image generate",
            data=_response_data(
                prompt=normalized_prompt,
                reference_images=reference_paths,
                aspect_ratio=aspect_ratio,
                resolution=normalized_resolution,
                count=count,
                model=normalized_model,
                output_dir=resolved_output_dir,
                dry_run=dry_run,
                execute=False,
            ),
        )

    images, screenshot_path = _execute_generation(
        prompt=normalized_prompt,
        reference_paths=reference_paths,
        aspect_ratio=aspect_ratio,
        resolution=normalized_resolution,
        count=count,
        model=normalized_model,
        output_dir=resolved_output_dir,
        timeout_minutes=timeout_minutes,
    )
    return CommandResponse(
        success=True,
        platform="jimeng",
        command="text-to-image generate",
        data=_response_data(
            prompt=normalized_prompt,
            reference_images=reference_paths,
            aspect_ratio=aspect_ratio,
            resolution=normalized_resolution,
            count=count,
            model=normalized_model,
            output_dir=resolved_output_dir,
            dry_run=False,
            execute=True,
            images=images,
            screenshot_path=screenshot_path,
        ),
    )
