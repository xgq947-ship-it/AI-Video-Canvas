# Evan 开发指南

最终用户使用 Electron 安装包，不需要自行安装 Node、Python 或 Chrome Beta，但必须安装正式版 Google Chrome。
本页只面向修改源码和制作安装包的开发者。

## 环境

- Node.js 22+
- Python 3.11+（推荐 3.12）

```bash
npm install
npm run setup
```

`npm install` 会安装项目锁定的原生 FFmpeg / FFprobe，开发机不需要再通过 Homebrew 安装。

需要调试 Google Flow、即梦时，再安装锁定的 Python 自动化运行时：

```bash
npm run setup:automation-runtime
```

这条命令会创建 `server/python/.venv/` 并安装 Playwright Python 依赖，不下载浏览器。
运行时使用系统 Google Chrome，并为 Evan 创建独立 Profile。

## 日常开发

```bash
npm start       # 推荐：打开完整 Electron 桌面应用，后端自动启动
npm run dev
npm test
npm run build
```

开发服务器使用前端 `5173`、后端 `3001`。桌面版后端由 Electron 分配随机 loopback
端口，不使用这两个固定端口。

> **不要同时运行 `npm run dev` 和已安装的桌面应用。**
> 两者共用同一份 `browser-profile`（登录一次两边都能用，见「浏览器自动化」），
> 因此也共用同一个 Evan 专属 Chrome 实例。而串行队列
> （`googleFlowWorkflowQueue`）只在单个后端进程内生效，跨进程不排队：
> 两个后端会互相切换页面、抢焦点，正在等结果的一方会拿到
> `SUBMISSION_UNKNOWN`——积分已扣但结果收不回来。调试时请先退出桌面应用。

## 桌面应用

```bash
npm run desktop:dev      # 构建前端并启动 Electron
npm run desktop:icons    # 从品牌 PNG 生成当前平台安装图标
npm run desktop:runtime  # 冻结独立 Ops CLI/Python 运行时
npm run desktop:verify   # 验收 Ops CLI、FFmpeg/FFprobe
npm run desktop:pack     # 生成未签名的应用目录
npm run desktop:dist:mac # 仅在 macOS：DMG + ZIP
npm run desktop:dist:win # 仅在 Windows x64：NSIS EXE
```

生成目录 `dist/`、`desktop-runtime/`、`release/` 都可安全删除并重新构建。

`desktop:runtime` 每次先清理旧的目标目录，防止 macOS 的 Mach-O/FFmpeg
残留进入 Windows 包，反之亦然。平台相关 Python、媒体工具必须在目标系统
原生生成；不要在 macOS 上把 `electron-builder --win` 生成的壳包当作正式 Windows
安装包。

仓库的 `.github/workflows/desktop-installers.yml` 支持手动触发或 `v*` Tag 触发，分别在
`macos-latest`（arm64）和 `windows-latest`（x64）runner 构建安装介质。`v*` Tag
构建会在两个平台均成功后创建 GitHub Release，随后删除 Actions 中用于跨 Job 传递的
临时产物；临时产物的 1 天保留期只用于发布失败兜底。

版本发布、跨电脑接手和存储边界见
[发布与跨电脑开发](发布与跨电脑开发.md)。不要把 `release/`、`desktop-runtime/`、
Python 虚拟环境或 `node_modules/` 提交进 Git。

正式分发前还需要 macOS 签名/公证、Windows Authenticode 签名和生产更新源。详细边界见
[桌面运行时架构](desktop-runtime-architecture.md)。

## 目录职责

- `src/`：React 画布
- `server/`：本地 API、生成流程和浏览器自动化
- `electron/`：桌面主进程与更新
- `shared/`：前后端共享规则
- `remotion/`：成片渲染
- `test/`：回归测试
- `library/`：本机用户项目和素材，不得作为源码清理对象

## 浏览器自动化

安装包不再携带 Chromium。Evan 检测系统正式版 Google Chrome，并通过独立
`browser-profile/` 保存 Flow/即梦登录态；应用更新不会覆盖。兼容性探针会阻止缺失或
版本过低的 Chrome 启动自动化。Remotion 使用同一个系统 Chrome 可执行文件，不会首次
渲染时联网下载浏览器。

`browser-profile/` 的位置**不随后端从哪个目录启动而变**，源码模式与桌面应用落在
同一处（`app.getPath('userData')/data/browser-profile`），所以在桌面应用里登录过
即梦/Flow 后，`npm run dev` 直接可用，无需重新登录。三处默认值必须保持一致：
`package.json` 的 `productName`、`server/runtime/paths.js` 的
`defaultBrowserProfileDir()`、`server/python/sessionhub/scene/chrome_cdp.py` 的
`_default_profile_dir()`——任一处改名都会让另外两处指向旧目录，症状是
「明明登录过却报尚未创建登录资料」。`test/runtimePaths.test.mjs` 有守卫。

## 媒体工具

FFmpeg `6.1.1` 与 FFprobe `6.1.1` 由锁定的 `ffmpeg-ffprobe-static` 平台包提供。源码模式
直接使用 `node_modules` 中的二进制；`npm run desktop:runtime` 会复制二进制与许可证信息，
桌面安装包从 `resources/media-tools/` 执行，不依赖系统 `PATH`。

当前迁移兼容层使用应用专用 CDP 端口 `19222`，且会校验 profile 所属进程，不会连接系统
用户日常 Chrome Profile。Windows 在普通登录实例切换到无头生成实例前会先按专属
Profile 精确关闭旧进程，等待退出时使用原生 PID 句柄，不在轮询中重复启动 PowerShell。
生成实例空闲 30 分钟后关闭；退出 Evan 时仍会立即回收。常驻 Worker 完成后将移除该固定
端口。

Windows 即梦生图优先复用 Evan 专属 Chrome 中已经存在的即梦标签页，避免已有标签较多时
创建新 CDP target 长时间阻塞；读取生成结果时只选择实际可见的记录区，忽略响应式布局
同时渲染的隐藏副本。产品短视频的“取消队列”会通过 `AbortSignal` 立即终止本地 Ops CLI
等待并释放浏览器队列。平台已经接单的生成可能仍会在远端完成，取消后不得自动重复提交。

顶部栏“刷新画布”会先保存当前改动，再从项目文件重新加载当前画布，用于同步后台任务
状态而不丢失尚未自动保存的编辑。删除项目图片节点时先清除节点选中态，避免磁盘回收站
操作期间残留已删除节点的提示词控制面板；图片与同时选中的文字节点会作为同一批次删除。

节点连线的目标判定使用浏览器返回的真实屏幕边界，不得假设所有节点都是固定宽高。松手时
必须按当前指针位置重新解析目标，不能只依赖上一次异步 hover 状态；连接点附近保留少量
屏幕像素容错，以兼容 Windows 鼠标和触控板快速拖放。

自动生成显式启动无头 Chrome。用户主动执行“打开 Evan 专属 Chrome/登录”才会切换成无自动化参数的可见实例；
后端不设置全局强制弹窗变量。

登录检查会先让可见实例正常退出并刷新 `browser-profile`，再以同一 Profile 无头执行
只读页面探针。退出时先终止 Chrome 主进程，让 Cookie 数据库正常落盘；超时才按
Profile 精确强杀残留进程，禁止同时结束全部 Helper 造成登录态丢失。

## 可选 AI CLI / MCP

Codex 和 Claude 不属于安装版的必需依赖。Evan 不把 Codex CLI 打入安装包，而是在运行
时自动发现用户单独安装、持续更新的版本。也可以在“设置 → Codex 服务”选择明确路径。
安装版会使用用户数据目录下独立的 `codex-home/`，并自动准备 Evan 画布 Skill 与队列
桥接命令；源码模式保留开发者现有的 `CODEX_HOME`。

需要安装或更新开发机的可选 CLI 时：

```bash
npm run setup:ai-cli
```

该命令始终请求当前最新版 `@openai/codex`，不会在仓库依赖中锁定 Codex 版本。CLI 更新
后只要可执行路径未改变，Evan 无需重新配置。

需要测试 Claude Code 本地剪辑编排时：

```bash
npm run mcp:claude
```

MCP 支持读取画布、分析配音、生成并应用剪辑计划以及触发 Remotion 预览；应用剪辑计划
必须显式确认且创建副本，不修改源画布。
