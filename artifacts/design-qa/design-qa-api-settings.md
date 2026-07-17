# 设计 QA：视频控制栏与 API 配置

- Source visual truth: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-e7933659-85e0-4e54-8360-09f0fb89b4f5.png`
- Implementation screenshot: `artifacts/design-qa/video-controls.png`
- Focused comparison: `artifacts/design-qa/video-controls-comparison.png`
- API settings modal: `artifacts/design-qa/api-settings-modal.png`
- Viewport: 1280 × 720
- State: dark theme; Seedance 2.0; 720p; 16:9; 4 seconds; audio enabled

## Full-view comparison evidence

实现截图显示视频控制栏仍位于提示词面板底部，层级、暗色背景、圆角、分隔线与原界面一致。右上角新增设置按钮没有遮挡保存、新建和主题按钮。

## Focused region comparison evidence

聚焦对比确认模型、本地上传、分辨率、比例、时长、音频和生成按钮保持原顺序；所有标签均为单行，异常的 `192:341` 已按模型能力回退为 `16:9`。实现采用更紧凑的水平密度，避免参考图中的两行文字和按钮高度不一致。

## Required fidelity surfaces

- Fonts and typography: 继续使用项目现有字体栈、字重和字号；控件文字不再换行或裁切。
- Spacing and layout rhythm: 控件间距统一为 8px，左右分组稳定，按钮高度一致；弹窗内容区可独立滚动。
- Colors and visual tokens: 延续中性黑灰底色、蓝色主操作和青色音频状态，没有引入新的冲突色。
- Image quality and asset fidelity: 本次界面没有新增位图资产；图标全部使用项目既有 Lucide 图标库。
- Copy and content: 设置入口、配置来源、保存状态、清除操作和安全说明均为中文，含义明确。

## Interaction verification

- 设置按钮可展开、点击外部可关闭。
- “配置 API 密钥”可打开居中弹窗，Esc、遮罩和关闭按钮均可关闭。
- 密钥可保存并立即生效；前端只显示掩码，不回显完整值。
- 手动密钥可清除，清除后回退 `.env`。
- 浏览器控制台无 error；仅存在项目原有 Tailwind CDN 开发警告。

## Findings

没有剩余 P0、P1 或 P2 问题。

## Comparison history

- 初始问题：模型名、本地上传、时长和音频文字换行；比例显示为无效值 `192:341`。
- 修复：增加不换行和收缩约束；模型切换时校验并重置比例；控制栏改为稳定的左右分组。
- 复核：实现截图中全部控件保持单行，显示 `16:9`，操作顺序和可见状态正确。

## Follow-up polish

- P3：项目仍通过 Tailwind CDN 注入样式，生产构建可在后续独立迁移为本地 PostCSS 配置。

final result: passed
