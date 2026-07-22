"""Google Flow 首帧图生视频 provider（image-to-video 能力）。

通过可见的 9222 浏览器驱动 Google Flow 页面 UI，不调用未公开 API，也不读取或持久化
Google 的 cookie / token / storage。浏览器生命周期、登录恢复、页面接管与结果等待逻辑
复用 `ops_cli.platforms._google_flow_common`。
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from ops_cli.output import CommandResponse
from ops_cli.platforms._google_flow_common import (
    GoogleFlowError,
    _attach_reference_images,
    _bring_login_browser_to_front,
    _clear_existing_prompt,
    _download_media,
    _ensure_editor,
    _exact_count,
    _existing_project_page,
    _find_replacement_project_page,
    _generation_failure_count,
    _import_browser_runtime,
    _is_flow_project_url,
    _project_work_page,
    _raise_auth_required,
    _resolve_project_url,
    wait_for_new_media,
)


GOOGLE_FLOW_SCENE = "google_flow/video_generate"
SUPPORTED_DURATIONS = (4, 6, 8, 10)
SUPPORTED_ASPECT_RATIOS = ("9:16", "16:9")
DEFAULT_MODEL = "Omni Flash"
SUPPORTED_MODELS = ("Omni Flash", "Veo 3.1 - Lite")
# 视频生成两种输入模式：
#   frames      —— 首帧图（Frames 子模式，Start 槽位），单张，历史行为。
#   ingredients —— 多参考图（Ingredients 子模式，composer 逐张 Add to Prompt）。
# 传了 --reference-image 即走 ingredients；否则用 --first-frame 走 frames。
MODE_FRAMES = "frames"
MODE_INGREDIENTS = "ingredients"


def _default_output_dir() -> Path:
    return Path.home() / "Desktop" / "GoogleFlow视频生成"


def _validate_inputs(
    *,
    prompt: str,
    first_frame: str,
    reference_images: list[str],
    duration: int,
    aspect_ratio: str,
    model: str,
    timeout_minutes: int,
) -> tuple[str, Path | None, list[Path], str, str]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise GoogleFlowError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空。")
    if duration not in SUPPORTED_DURATIONS:
        raise GoogleFlowError("DURATION_NOT_SUPPORTED", "--duration 只支持 4、6、8、10。")
    if aspect_ratio not in SUPPORTED_ASPECT_RATIOS:
        raise GoogleFlowError("ASPECT_RATIO_NOT_SUPPORTED", "--aspect-ratio 只支持 9:16、16:9。")
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

    has_first_frame = bool(str(first_frame or "").strip())
    # 传了参考图即走 Ingredients 多图模式；此时不接受 --first-frame，避免语义冲突。
    if reference_paths:
        if has_first_frame:
            raise GoogleFlowError(
                "INPUT_MODE_CONFLICT",
                "--reference-image（Ingredients 多参考图）与 --first-frame（首帧）不能同时使用。",
            )
        return normalized_prompt, None, reference_paths, normalized_model, MODE_INGREDIENTS

    if not has_first_frame:
        raise GoogleFlowError(
            "FIRST_FRAME_NOT_FOUND", "需提供 --first-frame（首帧）或 --reference-image（多参考图）之一。"
        )
    frame_path = Path(first_frame).expanduser().resolve()
    if not frame_path.is_file():
        raise GoogleFlowError("FIRST_FRAME_NOT_FOUND", f"首帧图片不存在：{frame_path}")
    return normalized_prompt, frame_path, [], normalized_model, MODE_FRAMES


def _response_data(
    *,
    prompt: str,
    first_frame: Path | None,
    reference_images: list[Path],
    mode: str,
    duration: int,
    aspect_ratio: str,
    model: str,
    output_dir: Path,
    dry_run: bool,
    execute: bool,
    video_path: str | None = None,
    video_url: str | None = None,
    screenshot_path: str | None = None,
) -> dict[str, Any]:
    return {
        "prompt": prompt,
        # 兼容旧消费者：first_frame 恒为字符串（ingredients 模式下为空串）。
        "first_frame": str(first_frame) if first_frame else "",
        "reference_images": [str(ref) for ref in reference_images],
        "mode": mode,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "model": model,
        "output_dir": str(output_dir),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "video_path": video_path,
        "video_url": video_url,
        "screenshot_path": screenshot_path,
        "source": "preview" if dry_run or not execute else "page",
        "scene": GOOGLE_FLOW_SCENE,
        "artifacts": [path for path in (video_path, screenshot_path) if path],
    }


def _open_settings_menu(page: Any) -> Any:
    """打开生成设置面板，兼容页面当前停留在 Image 或 Video 模式。

    汇总按钮文本会随当前模式变化：Video 模式常显示时长，Image 模式显示模型名；
    两种模式都会包含画幅图标 ligature ``crop_``，因此不能用 ``Video ·`` 作为前置条件。
    """
    settings = page.locator('button[aria-haspopup="menu"]').filter(has_text="crop_")
    _exact_count(settings, "PAGE_NAVIGATION_FAILED", "未找到视频设置按钮。")
    settings.click()

    menu = page.get_by_role("menu").filter(has_text="Generating will use")
    _exact_count(menu, "PAGE_NAVIGATION_FAILED", "未找到视频设置菜单。")
    return menu


def _configure_video(page: Any, *, duration: int, aspect_ratio: str, model: str, mode: str = MODE_FRAMES) -> None:
    menu = _open_settings_menu(page)

    video_tab = menu.get_by_role("tab", name="play_circle Video", exact=True)
    _exact_count(video_tab, "PAGE_NAVIGATION_FAILED", "未找到 Video 模式。")
    video_tab.click()

    # 输入子模式：ingredients → chrome_extension Ingredients（多参考图，无 Start 槽位）；
    # 否则 crop_free Frames（首帧/首尾帧）。两个子模式的比例/时长/模型选项一致。
    if mode == MODE_INGREDIENTS:
        ingredients_tab = menu.get_by_role("tab", name="chrome_extension Ingredients", exact=True)
        _exact_count(ingredients_tab, "REFERENCE_IMAGE_ADD_FAILED", "未找到 Ingredients 多参考图模式。")
        ingredients_tab.click()
    else:
        frames_tab = menu.get_by_role("tab", name="crop_free Frames", exact=True)
        _exact_count(frames_tab, "FIRST_FRAME_UPLOAD_FAILED", "未找到 Frames 首尾帧模式。")
        frames_tab.click()

    # ⚠️ 顺序很重要：必须先选模型，再选比例和时长。
    # Flow 的可选时长是**跟着模型变**的（例如 Veo 3.1 - Lite 与 Omni Flash
    # 提供的时长档位不同）。若先点时长，校验的是「上一个模型」的选项，
    # 会误报 DURATION_NOT_SUPPORTED；即使侥幸点中，切模型后也可能被重置。
    model_button = menu.locator('button[aria-haspopup="menu"]')
    _exact_count(model_button, "MODEL_NOT_FOUND", "未找到视频模型下拉框。")
    model_button.click()
    model_item = page.get_by_role("menuitem", name=f"volume_up {model}", exact=True)
    _exact_count(model_item, "MODEL_NOT_FOUND", f"页面未提供模型：{model}")
    model_item.click()
    # 选完模型菜单会收起，设置菜单也可能一起关掉，重新打开再设比例/时长。
    page.wait_for_timeout(800)
    if menu.count() == 0 or not menu.is_visible():
        menu = _open_settings_menu(page)

    ratio_name = "crop_9_16 9:16" if aspect_ratio == "9:16" else "crop_16_9 16:9"
    ratio_tab = menu.get_by_role("tab", name=ratio_name, exact=True)
    _exact_count(ratio_tab, "ASPECT_RATIO_NOT_SUPPORTED", f"页面未提供比例 {aspect_ratio}。")
    ratio_tab.click()

    # 有些 Flow 模型（如 Veo 3.1 - Lite）**完全不提供时长选择**，菜单里一个
    # "Ns" tab 都没有，只有比例和输出数量。这种情况要跳过而不是报错——
    # 之前无条件找 tab，导致这类模型必然 DURATION_NOT_SUPPORTED，根本没法用。
    duration_tabs = menu.get_by_role("tab").filter(has_text=re.compile(r"^\d+s$"))
    if duration_tabs.count() == 0:
        # 该模型时长固定，用它自己的默认值即可。
        pass
    else:
        duration_tab = menu.get_by_role("tab", name=f"{duration}s", exact=True)
        if duration_tab.count() != 1:
            offered = sorted({
                text.strip()
                for text in duration_tabs.all_inner_texts()
                if text.strip()
            })
            raise GoogleFlowError(
                "DURATION_NOT_SUPPORTED",
                f"模型「{model}」不提供 {duration}s 时长"
                + (f"，只支持 {'、'.join(offered)}。" if offered else "。"),
            )
        duration_tab.click()
    page.keyboard.press("Escape")


def _upload_first_frame(page: Any, frame_path: Path) -> None:
    start = page.locator('[type="button"][aria-haspopup="dialog"]').filter(has_text="Start")
    _exact_count(start, "FIRST_FRAME_UPLOAD_FAILED", "未找到 Start 首帧槽位。")
    start.click()

    dialog = page.get_by_role("dialog")
    _exact_count(dialog, "FIRST_FRAME_UPLOAD_FAILED", "未打开首帧素材选择框。")
    upload = dialog.get_by_role("button", name="upload Upload media", exact=True)
    _exact_count(upload, "FIRST_FRAME_UPLOAD_FAILED", "未找到 Upload media 按钮。")
    try:
        with page.expect_file_chooser(timeout=10_000) as chooser_info:
            upload.click()
        chooser_info.value.set_files(str(frame_path))
    except Exception as exc:
        raise GoogleFlowError("FIRST_FRAME_UPLOAD_FAILED", f"上传首帧失败：{exc}", retryable=True) from exc

    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if dialog.count() == 0 or not dialog.is_visible():
            return
        filename = dialog.get_by_text(frame_path.name, exact=True)
        if filename.count() == 1 and filename.is_visible():
            filename.click()
            try:
                dialog.wait_for(state="hidden", timeout=15_000)
            except Exception:
                pass
            return
        image = dialog.get_by_role("img", name=frame_path.name, exact=False)
        if image.count() == 1 and image.is_visible():
            image.click()
            try:
                dialog.wait_for(state="hidden", timeout=15_000)
            except Exception:
                pass
            return
        page.wait_for_timeout(1000)
    raise GoogleFlowError("FIRST_FRAME_UPLOAD_FAILED", "首帧上传完成后未能在素材框中定位该文件。", retryable=True)


def _video_urls(page: Any) -> list[str]:
    return page.locator("video").evaluate_all(
        "els => els.map(el => el.currentSrc || el.src || '').filter(Boolean)"
    )


def _wait_for_generated_video(
    page: Any,
    *,
    context: Any,
    project_url: str,
    previous_urls: set[str],
    previous_failure_count: int,
    timeout_minutes: int,
    created_pages: list[Any] | None = None,
) -> tuple[Any, str]:
    """视频只需等 1 个新结果，薄封装共享 wait_for_new_media。"""
    result_page, urls = wait_for_new_media(
        page,
        context=context,
        project_url=project_url,
        collect_urls=_video_urls,
        previous_urls=previous_urls,
        previous_failure_count=previous_failure_count,
        timeout_minutes=timeout_minutes,
        created_pages=created_pages,
        min_new=1,
    )
    return result_page, urls[0]


def _download_video(page: Any, video_url: str, output_dir: Path, stamp: str) -> str | None:
    return _download_media(page, video_url, output_dir, stamp, prefix="google_flow_", default_ext=".mp4")


def _execute_generation(
    *,
    prompt: str,
    first_frame: Path | None,
    reference_paths: list[Path],
    mode: str,
    duration: int,
    aspect_ratio: str,
    model: str,
    output_dir: Path,
    timeout_minutes: int,
) -> tuple[str | None, str, str]:
    cdp_url, PlaywrightError, PlaywrightTimeoutError, sync_playwright = _import_browser_runtime()
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            project_url = _resolve_project_url(context)
            # 只登记「本次自己新建」的接管页；复用到的既有标签不放进来，收尾时不关它。
            created_pages: list[Any] = []
            try:
                with _project_work_page(context, project_url) as page:
                    try:
                        page.goto(project_url, wait_until="domcontentloaded", timeout=60_000)
                        page.wait_for_timeout(3000)
                    except (PlaywrightError, PlaywrightTimeoutError) as exc:
                        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", f"打开 Google Flow 项目失败：{exc}", retryable=True) from exc
                    _ensure_editor(page)
                    _configure_video(page, duration=duration, aspect_ratio=aspect_ratio, model=model, mode=mode)
                    prompt_box = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
                    _exact_count(prompt_box, "PROMPT_INPUT_NOT_FOUND", "未找到提示词输入框。")

                    if mode == MODE_INGREDIENTS:
                        # 清掉上次残留的提示词/参考图。
                        _clear_existing_prompt(page)
                        # ⚠️ 必须「先写提示词、再挂参考图」。
                        # Add to Prompt 是把素材作为 chip **插进提示词框**的，
                        # 而 Playwright 的 fill() 会替换输入框的全部内容——
                        # 先挂图再 fill，刚插入的参考图 chip 会被整个清掉，
                        # 结果就是「图传上去了，但生成时压根没用上」。
                        prompt_box.fill(prompt)
                        _attach_reference_images(page, reference_paths)
                    else:
                        # 首帧走独立的 Start 槽位，不在提示词框里，顺序无影响。
                        _upload_first_frame(page, first_frame)
                        prompt_box.fill(prompt)

                    previous_urls = set(_video_urls(page))
                    previous_failure_count = _generation_failure_count(page)
                    create = page.get_by_role("button", name="arrow_forward Create", exact=True)
                    _exact_count(create, "GENERATE_BUTTON_NOT_FOUND", "未找到生成按钮。")
                    if not create.is_enabled():
                        raise GoogleFlowError("GENERATE_BUTTON_NOT_FOUND", "生成按钮不可用，请检查首帧和提示词。")
                    create.click()

                    result_page, video_url = _wait_for_generated_video(
                        page,
                        context=context,
                        project_url=project_url,
                        previous_urls=previous_urls,
                        previous_failure_count=previous_failure_count,
                        timeout_minutes=timeout_minutes,
                        created_pages=created_pages,
                    )
                    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    screenshot_path = output_dir / f"google_flow_{stamp}.png"
                    result_page.screenshot(path=str(screenshot_path), full_page=True, timeout=30_000)
                    video_path = _download_video(result_page, video_url, output_dir, stamp)
                    if not video_path and not video_url.startswith(("http://", "https://")):
                        raise GoogleFlowError(
                            "VIDEO_DOWNLOAD_FAILED",
                            "生成完成，但页面只返回临时 blob 地址，无法保存视频或提供可复用链接。",
                            retryable=True,
                        )
                    return video_path, video_url, str(screenshot_path)
            finally:
                # 关闭本次接管时自己新建的孤儿标签页；复用到的既有标签不在其中，
                # managed_work_page 创建的工作页由它自己的上下文管理器关闭。
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


def run_video_generate(
    *,
    prompt: str,
    first_frame: str = "",
    reference_images: list[str] | None = None,
    duration: int = 10,
    aspect_ratio: str = "9:16",
    model: str = DEFAULT_MODEL,
    output_dir: str | None = None,
    timeout_minutes: int = 15,
    dry_run: bool = False,
    execute: bool = False,
) -> CommandResponse:
    normalized_prompt, frame_path, reference_paths, normalized_model, mode = _validate_inputs(
        prompt=prompt,
        first_frame=first_frame,
        reference_images=reference_images or [],
        duration=duration,
        aspect_ratio=aspect_ratio,
        model=model,
        timeout_minutes=timeout_minutes,
    )
    resolved_output_dir = Path(output_dir).expanduser().resolve() if output_dir else _default_output_dir()

    if dry_run or not execute:
        return CommandResponse(
            success=True,
            platform="google_flow",
            command="image-to-video generate",
            data=_response_data(
                prompt=normalized_prompt,
                first_frame=frame_path,
                reference_images=reference_paths,
                mode=mode,
                duration=duration,
                aspect_ratio=aspect_ratio,
                model=normalized_model,
                output_dir=resolved_output_dir,
                dry_run=dry_run,
                execute=False,
            ),
        )

    video_path, video_url, screenshot_path = _execute_generation(
        prompt=normalized_prompt,
        first_frame=frame_path,
        reference_paths=reference_paths,
        mode=mode,
        duration=duration,
        aspect_ratio=aspect_ratio,
        model=normalized_model,
        output_dir=resolved_output_dir,
        timeout_minutes=timeout_minutes,
    )
    return CommandResponse(
        success=True,
        platform="google_flow",
        command="image-to-video generate",
        data=_response_data(
            prompt=normalized_prompt,
            first_frame=frame_path,
            reference_images=reference_paths,
            mode=mode,
            duration=duration,
            aspect_ratio=aspect_ratio,
            model=normalized_model,
            output_dir=resolved_output_dir,
            dry_run=False,
            execute=True,
            video_path=video_path,
            video_url=video_url,
            screenshot_path=screenshot_path,
        ),
    )
