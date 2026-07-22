# 当前图片反推提示词设计 QA

## Evidence

- Source visual truth: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-a57c300e-6d04-4739-ba1f-96388efd9479.png`
- Browser-rendered closed state: `/Users/dasheng/Desktop/AI-Video-Canvas/qa/reverse-image-prompt-final-1236x1020.png`
- Browser-rendered menu state: `/Users/dasheng/Desktop/AI-Video-Canvas/qa/reverse-image-prompt-menu-full.png`
- Full comparison: `/Users/dasheng/Desktop/AI-Video-Canvas/qa/reverse-image-prompt-final-comparison.png`
- Focused button evidence: `/Users/dasheng/Desktop/AI-Video-Canvas/qa/reverse-image-prompt-focused-final.png`
- Viewport: 1236 × 1020 CSS px, desktop dark theme.
- Source pixels: 1236 × 1020. Implementation pixels: 1236 × 1020. Device scale factor: 1. No density resampling was required.
- State: an existing image node with its own generated image selected; prompt panel open; new reverse-prompt control placed immediately left of 提示词优化.

## Full-view comparison

The new control occupies the exact empty toolbar position marked in the source. It preserves the existing prompt panel, node layout, model controls, canvas hierarchy, and dark visual language. The implementation project contains different media and canvas zoom, so fidelity judgments are limited to the requested prompt-toolbar region rather than unrelated canvas content.

## Focused region comparison

The focused evidence confirms equal 36 px control height, consistent border/radius, compact icon-label-chevron structure, 8 px inter-button gap, and alignment with the existing 提示词优化 control. The open-state screenshot confirms the menu anchors under the new button without shifting or hiding the existing optimizer.

## Required fidelity surfaces

- Fonts and typography: existing application font stack, 12 px semibold button label, 14 px menu titles, and 12 px secondary descriptions are reused.
- Spacing and layout rhythm: the button group uses the existing 36 px height, 12 px horizontal padding, 8 px gap, rounded-lg controls, and the same 288 px dropdown width as prompt optimization.
- Colors and visual tokens: neutral dark surface and border match the existing toolbar; cyan hover communicates image analysis while violet remains reserved for optimization.
- Image quality and asset fidelity: no new raster asset was required. The new ScanSearch icon comes from the application's existing Lucide icon family and renders sharply at 14 px.
- Copy and content: `生成图片提示词` is explicit. The menu separates `正常图片提示词` from `去除文案字幕`, with concise descriptions of text-handling behavior.
- Accessibility and states: semantic buttons, disabled state when the current node has no result image, loading label/spinner, hover title, outside-click dismissal, and mutual exclusion with the optimizer menu are implemented.

## Primary interactions tested

- Selected an existing image node and verified the control appears only in the image prompt toolbar.
- Verified the control is enabled when the current node has its own `resultUrl`.
- Opened the dropdown and verified both modes and descriptions.
- Opened the neighboring 提示词优化 menu and verified the two menus do not conflict.
- Verified both prompt instruction modes with automated tests: normal mode preserves visible text; no-text mode excludes copy, subtitles, labels, watermarks, and layout descriptions.
- Browser console checked: no errors.

## Comparison history

### Iteration 1

- No P0/P1/P2 visual mismatch was found in the requested toolbar region.
- User refinement added a dropdown with normal and no-text modes; the final open-state evidence confirms the additional menu remains aligned and readable.

## Findings

No actionable P0, P1, or P2 findings remain.

## Follow-up polish

- [P3] The live Gemini call was not triggered during QA to avoid transmitting an existing user project image solely for testing. Prompt construction, image-path handling, loading/error states, build, and automated tests were verified locally.

final result: passed
