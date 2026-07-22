"""Google Flow 文生图 provider（text-to-image 能力，Image 模式）。

通过可见的 9222 浏览器驱动 Google Flow 的 Image 生成 UI（默认模型 Nano Banana 2），
不调用未公开 API，也不读取或持久化 Google 的 cookie / token / storage。浏览器生命周期、
登录恢复、页面接管与结果等待逻辑复用 `ops_cli.platforms._google_flow_common`。

选择器来自对 9222 实时页面的只读探查（scene learning）：设置面板内 role=tab 控件——
模式 `image Image` / `play_circle Video`，比例 `crop_16_9 16:9` / `crop_landscape 4:3`
/ `crop_square 1:1` / `crop_portrait 3:4` / `crop_9_16 9:16`，张数 `1x` / `x2` / `x3` /
`x4`；模型下拉 `🍌 <model>`；提示词框与 `arrow_forward Create` 与视频模式一致。
"""

from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path
from typing import Any

from ops_cli.output import CommandResponse
from ops_cli.platforms._google_flow_common import (
    GoogleFlowError,
    _attach_reference_images,
    _clear_existing_prompt,
    _download_media,
    _ensure_editor,
    _exact_count,
    _first_option_selected,
    _import_browser_runtime,
    _generation_failure_count,
    _project_work_page,
    _resolve_project_url,
    _selected_media_matches_reference,
    wait_for_new_media,
)

# 参考图 composer 上传逻辑已上移到共享基座（与 image-to-video Ingredients 复用）。
# 这里保留同名再导出，兼容旧的模块内引用与单测（t2i._first_option_selected 等）。
__all__ = [
    "_attach_reference_images",
    "_clear_existing_prompt",
    "_first_option_selected",
    "_selected_media_matches_reference",
    "run_image_generate",
]


GOOGLE_FLOW_SCENE = "google_flow/image_generate"
SUPPORTED_ASPECT_RATIOS = ("16:9", "4:3", "1:1", "3:4", "9:16")
SUPPORTED_COUNTS = (1, 2, 3, 4)
# Flow Image 模式模型下拉（menuitem 文本均带 🍌 前缀，见 _configure_image）。
SUPPORTED_MODELS = ("Nano Banana 2", "Nano Banana Pro", "Nano Banana 2 Lite")
DEFAULT_ASPECT_RATIO = "1:1"
DEFAULT_COUNT = 1
DEFAULT_MODEL = "Nano Banana 2"

# 比例 → 设置面板内 role=tab 的可访问名（图标 ligature + 文案）。
_RATIO_TAB_NAMES = {
    "16:9": "crop_16_9 16:9",
    "4:3": "crop_landscape 4:3",
    "1:1": "crop_square 1:1",
    "3:4": "crop_portrait 3:4",
    "9:16": "crop_9_16 9:16",
}


def _default_output_dir() -> Path:
    return Path.home() / "Desktop" / "GoogleFlow生图"


def _validate_inputs(
    *,
    prompt: str,
    aspect_ratio: str,
    count: int,
    model: str,
    reference_images: list[str],
    timeout_minutes: int,
) -> tuple[str, str, list[Path]]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise GoogleFlowError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空。")
    if aspect_ratio not in SUPPORTED_ASPECT_RATIOS:
        raise GoogleFlowError(
            "ASPECT_RATIO_NOT_SUPPORTED", "--aspect-ratio 只支持 16:9、4:3、1:1、3:4、9:16。"
        )
    if count not in SUPPORTED_COUNTS:
        raise GoogleFlowError("COUNT_NOT_SUPPORTED", "--count 只支持 1、2、3、4。")
    normalized_model = str(model or "").strip()
    if not normalized_model:
        raise GoogleFlowError("MODEL_NOT_FOUND", "--model 不能为空。")
    if normalized_model not in SUPPORTED_MODELS:
        raise GoogleFlowError(
            "MODEL_NOT_SUPPORTED", f"--model 只支持 {', '.join(SUPPORTED_MODELS)}。"
        )
    if timeout_minutes <= 0:
        raise GoogleFlowError("GENERATION_TIMEOUT", "--timeout-minutes 必须大于 0。")
    reference_paths: list[Path] = []
    for raw in reference_images or []:
        ref = Path(str(raw)).expanduser().resolve()
        if not ref.is_file():
            raise GoogleFlowError("REFERENCE_IMAGE_NOT_FOUND", f"参考图不存在：{ref}")
        reference_paths.append(ref)
    return normalized_prompt, normalized_model, reference_paths


def _response_data(
    *,
    prompt: str,
    aspect_ratio: str,
    count: int,
    model: str,
    output_dir: Path,
    dry_run: bool,
    execute: bool,
    reference_images: list[Path] | None = None,
    images: list[dict[str, str | None]] | None = None,
    screenshot_path: str | None = None,
) -> dict[str, Any]:
    images = images or []
    artifacts = [img["path"] for img in images if img.get("path")]
    if screenshot_path:
        artifacts.append(screenshot_path)
    return {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "count": count,
        "model": model,
        "reference_images": [str(ref) for ref in (reference_images or [])],
        "output_dir": str(output_dir),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "images": images,
        "screenshot_path": screenshot_path,
        "source": "preview" if dry_run or not execute else "page",
        "scene": GOOGLE_FLOW_SCENE,
        "artifacts": artifacts,
    }


def _open_settings_menu(page: Any) -> Any:
    """打开生成设置面板并返回该 menu locator。

    汇总按钮文本随模式/模型变化（如「🍌 Nano Banana 2 crop_9_16 1x」），用比例图标
    ligature「crop_」定位，兼容不同模型名。
    """
    settings = page.locator('button[aria-haspopup="menu"]').filter(has_text="crop_")
    _exact_count(settings, "PAGE_NAVIGATION_FAILED", "未找到生图设置按钮。")
    settings.click()
    menu = page.get_by_role("menu").filter(has_text="crop_16_9")
    _exact_count(menu, "PAGE_NAVIGATION_FAILED", "未找到生图设置菜单。")
    return menu


def _configure_image(page: Any, *, aspect_ratio: str, count: int, model: str) -> None:
    menu = _open_settings_menu(page)

    image_tab = menu.get_by_role("tab", name="image Image", exact=True)
    _exact_count(image_tab, "PAGE_NAVIGATION_FAILED", "未找到 Image 模式。")
    image_tab.click()

    ratio_name = _RATIO_TAB_NAMES[aspect_ratio]
    ratio_tab = menu.get_by_role("tab", name=ratio_name, exact=True)
    _exact_count(ratio_tab, "ASPECT_RATIO_NOT_SUPPORTED", f"页面未提供比例 {aspect_ratio}。")
    ratio_tab.click()

    count_name = "1x" if count == 1 else f"x{count}"
    count_tab = menu.get_by_role("tab", name=count_name, exact=True)
    _exact_count(count_tab, "COUNT_NOT_SUPPORTED", f"页面未提供张数 {count_name}。")
    count_tab.click()

    # 默认模型（Nano Banana 2）通常已选中；仅在请求了别的模型时才切换。
    if model != DEFAULT_MODEL:
        model_button = menu.locator('button[aria-haspopup="menu"]')
        _exact_count(model_button, "MODEL_NOT_FOUND", "未找到生图模型下拉框。")
        model_button.click()
        # exact=True 避免「Nano Banana 2」误匹配「Nano Banana 2 Lite」。
        model_item = page.get_by_role("menuitem", name=f"🍌 {model}", exact=True)
        _exact_count(model_item, "MODEL_NOT_FOUND", f"页面未提供模型：{model}")
        model_item.click()

    page.keyboard.press("Escape")


def _image_urls(page: Any) -> list[str]:
    # 只取生成结果图（媒体重定向 URL），排除头像 / UI 图标。
    return page.locator("img").evaluate_all(
        "els => els.map(el => el.currentSrc || el.src || '')"
        ".filter(u => u.includes('media.getMediaUrlRedirect'))"
    )


def _capture_proof_screenshot(page: Any, screenshot_path: Path) -> str | None:
    """尽力保存页面存证；截图失败不能推翻已经完成的生成结果。"""
    try:
        page.screenshot(
            path=str(screenshot_path),
            full_page=False,
            timeout=15_000,
            animations="disabled",
        )
        return str(screenshot_path)
    except Exception:
        return None


def _execute_generation(
    *,
    prompt: str,
    aspect_ratio: str,
    count: int,
    model: str,
    reference_paths: list[Path],
    output_dir: Path,
    timeout_minutes: int,
) -> tuple[list[dict[str, str | None]], str | None]:
    cdp_url, PlaywrightError, PlaywrightTimeoutError, sync_playwright = _import_browser_runtime()
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            project_url = _resolve_project_url(context)
            created_pages: list[Any] = []
            try:
                with _project_work_page(context, project_url, "google-flow.image.generate") as page:
                    try:
                        page.goto(project_url, wait_until="domcontentloaded", timeout=60_000)
                        page.wait_for_timeout(3000)
                    except (PlaywrightError, PlaywrightTimeoutError) as exc:
                        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", f"打开 Google Flow 项目失败：{exc}", retryable=True) from exc
                    _ensure_editor(page)
                    _clear_existing_prompt(page)
                    _configure_image(page, aspect_ratio=aspect_ratio, count=count, model=model)
                    if reference_paths:
                        _attach_reference_images(page, reference_paths)

                    prompt_box = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
                    _exact_count(prompt_box, "PROMPT_INPUT_NOT_FOUND", "未找到提示词输入框。")
                    prompt_box.fill(prompt)

                    previous_urls = set(_image_urls(page))
                    previous_failure_count = _generation_failure_count(page)
                    create = page.get_by_role("button", name="arrow_forward Create", exact=True)
                    _exact_count(create, "GENERATE_BUTTON_NOT_FOUND", "未找到生成按钮。")
                    if not create.is_enabled():
                        raise GoogleFlowError("GENERATE_BUTTON_NOT_FOUND", "生成按钮不可用，请检查提示词。")
                    create.click()

                    result_page, image_urls = wait_for_new_media(
                        page,
                        context=context,
                        project_url=project_url,
                        collect_urls=_image_urls,
                        previous_urls=previous_urls,
                        previous_failure_count=previous_failure_count,
                        timeout_minutes=timeout_minutes,
                        created_pages=created_pages,
                        min_new=count,
                    )
                    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    images: list[dict[str, str | None]] = []
                    for index, url in enumerate(image_urls, start=1):
                        path = _download_media(
                            result_page, url, output_dir, f"{stamp}_{index}", prefix="google_flow_img_", default_ext=".png"
                        )
                        images.append({"path": path, "url": url})
                    if not any(img["path"] for img in images) and not any(
                        (img["url"] or "").startswith(("http://", "https://")) for img in images
                    ):
                        raise GoogleFlowError(
                            "IMAGE_DOWNLOAD_FAILED",
                            "生成完成，但无法保存图片，也没有可复用的图片链接。",
                            retryable=True,
                        )
                    screenshot_path = _capture_proof_screenshot(
                        result_page,
                        output_dir / f"google_flow_img_{stamp}.png",
                    )
                    return images, screenshot_path
            finally:
                # 关闭本次接管时自己新建的孤儿标签页；复用到的既有标签不在其中。
                for extra in created_pages:
                    try:
                        if not extra.is_closed():
                            extra.close()
                    except Exception:
                        pass
    except GoogleFlowError:
        raise
    except Exception as exc:
        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", f"Google Flow 页面自动化失败：{exc}", retryable=True) from exc


def run_image_generate(
    *,
    prompt: str,
    aspect_ratio: str = DEFAULT_ASPECT_RATIO,
    count: int = DEFAULT_COUNT,
    model: str = DEFAULT_MODEL,
    reference_images: list[str] | None = None,
    output_dir: str | None = None,
    timeout_minutes: int = 10,
    dry_run: bool = False,
    execute: bool = False,
) -> CommandResponse:
    normalized_prompt, normalized_model, reference_paths = _validate_inputs(
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        count=count,
        model=model,
        reference_images=reference_images or [],
        timeout_minutes=timeout_minutes,
    )
    resolved_output_dir = Path(output_dir).expanduser().resolve() if output_dir else _default_output_dir()

    if dry_run or not execute:
        return CommandResponse(
            success=True,
            platform="google_flow",
            command="text-to-image generate",
            data=_response_data(
                prompt=normalized_prompt,
                aspect_ratio=aspect_ratio,
                count=count,
                model=normalized_model,
                reference_images=reference_paths,
                output_dir=resolved_output_dir,
                dry_run=dry_run,
                execute=False,
            ),
        )

    images, screenshot_path = _execute_generation(
        prompt=normalized_prompt,
        aspect_ratio=aspect_ratio,
        count=count,
        model=normalized_model,
        reference_paths=reference_paths,
        output_dir=resolved_output_dir,
        timeout_minutes=timeout_minutes,
    )
    return CommandResponse(
        success=True,
        platform="google_flow",
        command="text-to-image generate",
        data=_response_data(
            prompt=normalized_prompt,
            aspect_ratio=aspect_ratio,
            count=count,
            model=normalized_model,
            reference_images=reference_paths,
            output_dir=resolved_output_dir,
            dry_run=False,
            execute=True,
            images=images,
            screenshot_path=screenshot_path,
        ),
    )
