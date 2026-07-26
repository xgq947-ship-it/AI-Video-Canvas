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
from ops_cli.platforms._google_flow_common import _download_media, _import_browser_runtime
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


def _image_urls(page: Any) -> list[str]:
    # 只从主结果记录区取图。上传参考图后，composer 缩略图会先用 blob:，提交后再
    # 换成带签名的 http URL；若扫描整页，它会被误判成新结果，导致参考图单张返回
    # 原图、参考图多张在第 2 张仍生成时提前成功。
    result_area = page.locator("[class*='record-list']")
    root = result_area.first if result_area.count() > 0 else page
    candidates = root.locator("img").evaluate_all(
        """els => els.map(el => ({
             src: el.currentSrc || el.src || '',
             width: el.naturalWidth || 0,
             height: el.naturalHeight || 0,
             renderedWidth: el.getBoundingClientRect().width || 0,
             renderedHeight: el.getBoundingClientRect().height || 0,
           }))
           .filter(item => item.src.startsWith('http')
             && item.width >= 256 && item.height >= 256
             && item.renderedWidth >= 96 && item.renderedHeight >= 96)
           .map(item => item.src)"""
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
    return parsed.path or str(url or "")


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
    raise JimengError(
        "SUBMISSION_UNKNOWN",
        f"等待即梦图片生成超过 {timeout_minutes} 分钟，无法确认任务最终状态。{detail}",
        retryable=False,
        recovery_hint=(
            "图片生成请求已经提交，请先在即梦历史会话中确认结果；"
            "确认没有任务后再重新生成，避免重复消耗积分。"
        ),
    )


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
                image_urls = _wait_for_images(
                    page,
                    previous_urls=previous_urls,
                    expected=count,
                    timeout_minutes=timeout_minutes,
                )

                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                images: list[dict[str, str | None]] = []
                for index, url in enumerate(image_urls, start=1):
                    saved = _download_media(
                        page,
                        url,
                        output_dir,
                        f"{stamp}_{index}",
                        prefix="jimeng_img_",
                        default_ext=".png",
                    )
                    images.append({"path": saved, "url": url})
                _ensure_result_delivery(
                    images,
                    error_code="IMAGE_DOWNLOAD_FAILED",
                    media_label="图片",
                )
                screenshot = output_dir / f"jimeng_img_{stamp}.png"
                try:
                    page.screenshot(path=str(screenshot), full_page=False, timeout=30_000)
                    screenshot_path: str | None = str(screenshot)
                except Exception:
                    screenshot_path = None
                return images, screenshot_path
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
