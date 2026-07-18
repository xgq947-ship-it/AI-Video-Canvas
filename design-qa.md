**Source visual truth**

- `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-233c3ed2-63b3-4933-bd5f-1720de3bed7f.png`
- Supporting states: `codex-clipboard-cfe87e6a-4c1e-4ed2-bbf5-b71075fc5cbe.png`, `codex-clipboard-0058ba90-eb42-4477-ab5a-d95f364c76b4.png`
- Overflow regression references: `codex-clipboard-629a71ca-5818-45a2-93e0-e0d239b02ff6.png`, `codex-clipboard-637e44f0-1a83-4b48-8542-7e7e8469bf9a.png`
- Asset deletion reference: `codex-clipboard-d310bb88-3430-42cf-b70e-a5064bfd1c65.png`

**Implementation evidence**

- Screenshot: `sidebar-implementation.png`
- Combined comparison: `sidebar-comparison.png`
- Overflow fix screenshot: `sidebar-panel-fixed.png`
- Narrow sidebar screenshot: `sidebar-300px.png`
- Local image deletion screenshot: `sidebar-delete-image-confirm.png`
- Viewport: 1280 x 720
- State: dark theme, expanded sidebar, Canvas tab, empty current canvas

**Full-view comparison evidence**

The combined comparison confirms the same persistent left-rail composition, dark surface hierarchy, project header, Canvas/Assets tabs, scrollable content region, and fixed footer navigation. The implementation keeps the application's real TwitCanva logo and existing canvas controls instead of copying the source product's branding.

**Focused region comparison evidence**

The left sidebar was reduced from 390 px to 300 px after user review. Typography, tab treatment, separators, icon sizing, empty-state hierarchy, and footer alignment remain readable at the narrower width.

**Findings**

- No actionable P0, P1, or P2 mismatch remains.
- P3: The TwitCanva purple logo differs from the white reference logo. This is intentional product-brand preservation.
- P3: The source populated Canvas state contains many thumbnail rows, while the implementation evidence shows the matching empty state because the current unsaved canvas has zero nodes. The populated Assets state was separately verified with real local image records.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing system sans stack, weights, truncation, line height, and muted hierarchy match the product and reference density.
- Spacing and layout rhythm: passed. Sidebar width, header/tabs/content/footer segmentation, row radii, padding, and fixed footer remain consistent.
- Colors and visual tokens: passed. Near-black canvas, #151515 sidebar, neutral borders, selected surfaces, and muted foregrounds match the reference direction.
- Image quality and asset fidelity: passed. The implementation uses the existing TwitCanva logo and actual library thumbnails; no placeholder imagery or handcrafted icons replace visible assets.
- Copy and content: passed. Labels are localized and correspond to real project concepts and actions.

**Interactions tested**

- Project menu opens and exposes return, all projects, create, and delete states.
- Canvas and Assets tabs switch correctly.
- Personal assets load from the local backend.
- Asset search filters the visible list.
- Sidebar collapses to a narrow rail and expands again.
- Expanded footer now retains only the useful Workflows and AI Storyboard actions.
- Workflow panel opens at x=410, y=200 with a 700 x 317 visible rect inside the 1280 x 720 viewport.
- Browser console errors checked: none.
- Personal image overflow menu exposes a local-delete action, requires a second confirmation, and can be cancelled without changing the asset list.
- The confirmation surface remains fully visible inside the 1280 x 720 viewport (`x=57`, `y=373`, `width=210`, `height=118`).
- Backend deletion was verified with an isolated temporary fixture: both the image file and its metadata JSON were removed. No user asset was deleted during QA.

**Comparison history**

1. Initial capture exposed the empty-start panel centered across the whole viewport, partially underneath the new sidebar.
2. Fixed the content offset so the start panel centers within the remaining canvas.
3. Post-fix capture confirms the sidebar and canvas no longer overlap.
4. The bottom-triggered workflow panel originally extended beyond the viewport. The panel now clamps its top, left, and width to the available canvas; the post-fix screenshot confirms its full 700 x 317 surface is visible. Redundant History and Asset footer shortcuts were removed because those functions are already available in the Assets tab.
5. User feedback identified the 390 px sidebar as too wide. It was reduced to 300 px, all canvas and panel offsets were centralized around the new constant, and browser evidence confirms `clientWidth=299`, `scrollWidth=299` with no horizontal overflow in normal or expanded-search states.

**Implementation checklist**

- Persistent project sidebar integrated with the current app.
- Real workflow, node, generated-asset, and curated-library data connected.
- Search, filtering, selection, node location, project menu, and collapse behavior implemented.
- Personal image deletion synchronizes the sidebar state with removal of the local media file and metadata record.
- Production build and automated tests passed.

final result: passed

---

# 新建空画布与工作流真实缩略图设计 QA

- source visual truth paths:
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-efdd6487-84f5-447b-a8c3-009012fd4ffd.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-dddb035a-743a-4228-9205-c683be9cafa9.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-ff78c83a-a289-44e7-be74-4a848c17989e.png`
- implementation screenshot paths:
  - `/tmp/twitcanva-new-project-empty-final.png`
  - `/tmp/twitcanva-workflow-thumbnails-final.png`
  - `/tmp/twitcanva-workflow-loaded-fit-center.png`
- side-by-side comparison paths:
  - `/tmp/twitcanva-new-project-comparison.png`
  - `/tmp/twitcanva-workflow-thumbnails-comparison.png`
- viewport: `1458 × 768`
- state: 深色主题；分别验证新建空项目、项目选择面板、加载 25 节点项目

## Full-view comparison evidence

新建项目不再显示中央“开始一部 AI 漫剧”引导卡，直接保留完整空画布。项目选择卡片使用实际节点坐标、连接关系和图片内容生成微型画布，不再显示通用文件图标。加载已有项目后，整个节点包围盒自动适配并居中显示。

## Focused region comparison evidence

工作流卡片的预览完整保留真实横向节点链路和右侧纵向图片节点；无图片节点使用中性卡片表示。手动设置的封面仍优先显示，未设置封面时才自动使用画布缩略图。

## Findings

- 无 P0/P1/P2 问题。
- P3：项目选择面板沿用当前产品的紧凑宽度，没有扩大为参考截图的全宽面板；本轮仅替换预览内容和空画布行为。

## Required fidelity surfaces

- 字体与排版：通过。继续沿用现有工作流卡片标题、节点数量和截断规则。
- 间距与布局：通过。缩略图保持 `4:3`，真实画布按节点包围盒居中适配。
- 颜色与视觉令牌：通过。节点、连线和空状态使用现有深色中性色。
- 图片质量：通过。缩略图直接使用真实工作流图片地址，无占位图和伪造素材。
- 文案与内容：通过。新建项目仅保留侧边栏“画布暂无节点”，中央无额外引导文案。

## Interactions tested

- 点击“新建”后节点数为 `0`、缩放恢复 `100%`、中央引导卡数量为 `0`。
- 打开“我的工作流”后存在 `3` 个真实画布缩略图，其中共渲染 `20` 张节点图片。
- 点击“莫妮卡在上海 · 分句配音口型校准版”后加载 `25` 个节点，面板自动关闭。
- 加载后缩放为 `13%`；画布中心为 `(859, 384)`，节点内容中心为 `(859, 383.9)`。
- 浏览器控制台无错误。
- `npx tsc --noEmit` 通过；`npm test` 81 项全过；`npm run build` 成功。

## Comparison history

1. 初始项目卡片只显示文件图标，无法识别工作流画面；项目加载后沿用旧视口，可能看不到节点。
2. 第一轮接入真实画布缩略图后，节点连线在小卡片中偏粗。
3. 收紧缩略图连线与边框，并在加载时按真实节点包围盒自动适配；同视口复测通过。

final result: passed

---

# 画布选中工具栏固定尺寸设计 QA

- source visual truth paths:
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-dd6bac2d-9f82-49a9-a366-842664050c59.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-234aebef-8364-4acc-a486-1df6eff24907.png`
- implementation screenshot paths:
  - `/tmp/twitcanva-node-controls-20pct.png`
  - `/tmp/twitcanva-multi-select-toolbar-20pct.png`
  - `/tmp/twitcanva-multiselect-comparison.png`
- viewport: `1536 × 912`
- state: 深色主题；分别验证 20% 缩放下单节点选中和多节点框选

## Full-view comparison evidence

单节点操作面板和多选“打组”工具栏均改为固定屏幕尺寸，不再随画布缩放。20% 缩放下，画布节点保持缩小，操作文字、图标和点击区域仍保持正常可读大小。

## Focused region comparison evidence

多选工具栏位于选择框正上方，“打组”文字保持单行显示。单节点悬浮工具栏使用横向紧凑布局，中文标签不再逐字换行，也不会因低缩放被放大成超高面板。

## Findings

- 无 P0/P1/P2 问题。
- P3：本项目保留现有工具栏按钮集合，没有复制参考产品中与当前工作流无关的操作。

## Required fidelity surfaces

- 字体与排版：通过。提示词正文为 `17 px / 28 px`，工具栏文字为固定屏幕尺寸且保持单行。
- 间距与布局：通过。工具栏紧贴选择框正上方，按钮内边距和分隔线恢复为紧凑尺寸。
- 颜色与视觉令牌：通过。沿用现有深色表面、边框、悬浮态和蓝色强调色。
- 图片质量：通过。节点原图和缩略图渲染未改动。
- 文案：通过。多选操作显示中文“打组”。

## Interactions tested

- 新建两个图片节点并框选，100% 与 20% 缩放下“打组”按钮均清晰可见。
- 20% 缩放下选中单节点，提示词面板和底部控件保持固定可读尺寸。
- 框选、缩放、单选和删除临时测试节点均正常。
- 浏览器控制台无错误。
- `npx tsc --noEmit` 通过；`npm test` 77 项全过；`npm run build` 成功。

## Comparison history

1. 初始实现的工具栏尺寸受画布缩放影响，低缩放下文字不可读。
2. 首轮固定尺寸后，中文按钮因容器收缩发生逐字换行，导致工具栏过高。
3. 增加单行与禁止收缩约束，并恢复紧凑字号、图标和内边距；20% 缩放复测通过。

final result: passed

---

# 紧凑添加节点菜单与缩放菜单设计 QA

- source visual truth paths:
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-0b0c8d30-8315-4ea0-b05d-1b270dd60f5f.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-3963a2a0-cdd9-4688-ad15-5cde97d805a3.png`
- implementation screenshot paths:
  - `/tmp/twitcanva-compact-add-menu.png`
  - `/tmp/twitcanva-zoom-menu.png`
- viewport: `1280 × 720`
- state: 深色主题、空画布；分别打开紧凑添加节点菜单和缩放菜单

## Full-view comparison evidence

添加节点菜单已从原先的大面积面板压缩为 `272 × 498 px`，保留全部入口、分区、状态标签和内部滚动，同时明显减少对画布内容的遮挡。缩放控件由持续占宽的滑杆改为紧凑百分比按钮，菜单向上展开，布局与参考图的输入框、操作项和预设比例结构一致。

## Focused region comparison evidence

参考图与实现截图已并排检查。添加节点菜单的圆角、深灰层级、图标文字对齐和行间距已统一收紧；缩放菜单包含可编辑百分比、放大、缩小、适合屏幕以及常用比例，底部控制栏保持紧凑且不遮挡侧边栏。

## Findings

- 无 P0/P1/P2 问题。
- P3：参考产品提供最高 `800%`，本项目沿用现有 `200%` 缩放上限，避免改变当前画布缩放契约。

## Required fidelity surfaces

- 字体与排版：通过。沿用项目字体体系，菜单标签和辅助文字层级清晰。
- 间距与布局：通过。添加菜单宽度、行高、内边距均已压缩；缩放菜单与触发按钮对齐。
- 颜色与视觉令牌：通过。深色表面、边框、悬浮态和选中态与现有画布一致。
- 图标与内容：通过。复用现有 Lucide 图标，中文文案完整。
- 响应与遮挡：通过。添加菜单保持点击位置为左上角，必要时内部滚动；缩放菜单向上展开。

## Interactions tested

- 双击画布打开添加菜单，实测矩形为 `left=760, top=100, width=272, height=498`，10 个入口完整存在。
- 点击 `50%` 后画布变换为 `translate(245px, 180px) scale(0.5)`。
- 输入 `75` 并回车后，按钮显示 `75%`，画布变换为 `translate(122.5px, 90px) scale(0.75)`。
- 放大、缩小、适合屏幕、`50%`、`100%`、`200%` 均已接入现有画布缩放逻辑。
- 干净浏览器标签页控制台无错误。
- `npx tsc --noEmit` 通过；`npm test` 59 项全过；`npm run build` 成功。

## Comparison history

- 首轮实现完成后未发现 P0/P1/P2 差异，无需阻断式返工。

## Final result

final result: passed
---

## Canvas minimap QA — 2026-07-16

**Source visual truth**

- `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-7c43d904-b744-4202-9a92-fce13efba585.png`
- Expanded reference: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-a0a1f979-f6ab-4bec-a8f6-b5ce128d6a36.png`
- Full-canvas placement reference: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-ab4a0f25-7c29-4a83-a0dc-876aaf951431.png`

**Implementation evidence**

- Expanded state: `canvas-minimap-expanded.png`
- Collapsed state: `canvas-minimap-collapsed.png`
- Full comparison: `canvas-minimap-full-comparison.png`
- Focused comparison: `canvas-minimap-focused-comparison.png`
- Viewport: 1280 x 720
- State: dark theme, expanded sidebar, 8-node AI manga workflow, minimap expanded

**Full-view comparison evidence**

The combined full view confirms the same bottom-left placement beside the canvas rail, dark floating surface, compact navigation control, and minimap positioned directly above its trigger. The source contains a much larger 444-node production canvas while the implementation evidence uses the application's generated 8-node workflow, so node density is intentionally content-dependent.

**Focused region comparison evidence**

The combined focused comparison confirms the reference pattern: rounded dark overview panel, simplified node rectangles, a contrasting viewport outline, selected map button, nearby zoom percentage, and an attached control bar. The implementation retains the existing zoom slider because it is a working product control; unrelated reference-app toolbar buttons were not copied.

**Findings**

- No actionable P0, P1, or P2 mismatch remains.
- P3: The implementation overview is slightly shorter than the expanded reference. This keeps more of the active canvas visible while preserving the same information hierarchy.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing product system font and compact 12 px control labels remain consistent.
- Spacing and layout rhythm: passed. The map, 8 px inter-surface gap, rounded panel, and bottom-left offset match the reference pattern without overlapping the sidebar.
- Colors and visual tokens: passed. Neutral dark surfaces, gray node blocks, white viewport outline, and active control surface match the current product theme.
- Image quality and asset fidelity: passed. The minimap is a live visualization of actual node geometry rather than a raster placeholder.
- Copy and content: passed. Tooltip and accessibility labels use Chinese copy: `画布小地图` and `画布缩放`.

**Interactions tested**

- Minimap button opens and closes the overview; `aria-pressed` updates between `true` and `false`.
- Eight live nodes render as overview rectangles.
- Current visible canvas renders as an outlined viewport rectangle.
- Clicking the minimap moved the canvas transform from `translate(90px, 82px)` to `translate(31.25px, 82px)` at 62% zoom.
- Drag behavior is implemented with pointer capture so navigation continues while the pointer is held.
- Browser interaction completed without a runtime exception or visible error overlay.

**Comparison history**

1. Initial implementation matched the reference composition and interaction model; the first combined full and focused comparisons found no P0/P1/P2 issue, so no blocking visual correction loop was required.

**Implementation checklist**

- Live node distribution connected to current canvas state.
- Live viewport outline connected to pan and zoom state.
- Click-and-drag minimap navigation implemented.
- Expand/collapse control and tooltip implemented.
- Production build and 30 automated tests passed.

final result: passed

---

# 双击添加节点菜单设计 QA

- source visual truth path: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-6bbcd9e6-153b-4c0a-8533-26834c27afe4.png`
- implementation screenshot path: `/tmp/twitcanva-add-node-menu-focused-tall.png`
- viewport: `1280 × 960`
- state: 深色画布，在屏幕坐标 `(760, 54)` 双击空白区域后打开菜单

## Full-view comparison evidence

实现保留参考模板的单列层级、深灰背景、大圆角、无图标底板、右侧状态标签、资源分区和底部上传入口。菜单在画布上方显示，不影响侧边栏和顶部操作区。

## Focused region comparison evidence

已在同一次视觉检查中并排打开参考图与实现局部截图。字体层级、行距、图标与文字对齐、Beta/NEW 标签、分区标题和圆角边框均与模板方向一致。项目继续复用现有 Lucide 图标体系，个别图标造型与参考产品不同，属于可接受的产品设计系统差异。

## Findings

- 无 P0/P1/P2 问题。
- P3：实现为适配当前桌面画布密度，菜单宽度和行高比参考截图略紧凑。
- P3：部分图标使用项目现有 Lucide 对应图标，与参考图的专有图标不完全相同。

## Interaction and positioning evidence

- 双击 `(760, 180)`：菜单矩形为 `left=760, top=180, width=320, height=528`。
- 双击靠近底部 `(1080, 560)`：菜单 `top=560`，未再向上回推；右侧空间不足时仅做水平防溢出。
- 下方空间不足时菜单内部滚动，全部 10 个入口仍存在且可操作。
- “从生成历史选择”已实际点击验证，菜单关闭并成功打开生成历史面板。
- 浏览器控制台未出现本次改动引入的错误。

## Comparison history

- 首轮对比未发现 P0/P1/P2 差异，无需阻断式返工。

## Final result

final result: passed

---

# 侧边栏缩小与项目菜单迁移设计 QA

- source visual truth paths:
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-5ba5012a-97ce-402f-b589-b6c20bd80d01.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-351f941a-7d5e-4610-b5bb-a42edc8d7b01.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-4420703f-889f-48aa-9e34-2e455d5b9833.png`
- implementation screenshot paths:
  - `/tmp/twitcanva-compact-overview.png`
  - `/tmp/twitcanva-project-menu-moved.png`
- viewport: `1280 × 720`
- state: 深色主题、空画布；分别验证项目菜单关闭与展开状态

## Full-view comparison evidence

侧边栏由 `300 px` 缩小为 `260 px`，顶部 Logo 整行已删除，画布获得更多可视空间。中央起始卡片同步从最大 `620 px` 缩小为 `560 px`，标题、图标、按钮和间距按同一比例收紧，整体密度更接近参考图。

## Focused region comparison evidence

项目菜单已从原 Logo 按钮完整迁移到书本图标。菜单从书本图标下方向左展开，宽度压缩为 `228 px`，保留“回到画布、全部项目、创建新项目、删除项目”的顺序、分隔线、禁用状态和点击行为。

## Findings

- 无 P0/P1/P2 问题。
- P3：参考项目菜单圆角和字号更大；当前实现按用户本轮“整个画面缩小”的要求保持更紧凑尺寸。

## Required fidelity surfaces

- 布局：通过。Logo 行彻底移除，书本图标留在画布/资产标签行右侧。
- 尺寸：通过。侧边栏实测宽度 `260 px`、`scrollWidth=259 px`，无横向溢出。
- 菜单：通过。四项功能完整，删除项目在无工作流时保持禁用。
- 视觉：通过。沿用现有深色表面、边框、圆角和 Lucide 图标体系。
- 画布偏移：通过。侧边栏宽度继续通过共享常量传入画布相关组件，没有新增裸坐标换算。

## Interactions tested

- 展开侧边栏中 `img[alt="TwitCanva"]` 数量实测为 `0`。
- 书本图标点击后 `aria-expanded=true`，四个项目操作全部出现。
- 再次点击书本图标可关闭菜单。
- `npx tsc --noEmit` 通过；`npm test` 59 项全过；`npm run build` 成功。

## Final result

final result: passed
