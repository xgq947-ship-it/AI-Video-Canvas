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

需要调试 Google Flow、Gemini Web、即梦时，再安装锁定的 Python 自动化运行时：

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

## 统一画布短视频复刻

短视频复刻的当前入口是画布内 `Video Analysis` 节点，不再通过独立工作区渲染。修改这条链路时，
必须同时考虑以下边界：

- 四个输入端口由 `inputPortByParentId` 表示：`source-video`、`product-reference`、
  `character-reference`、`scene-reference`；不得依赖 `parentIds` 顺序。
- `server/services/videoAnalysisService.js` 只负责把现有 Video Remix 拆镜/分析能力适配成
  轻量 `global + shots[]` 结果；图片、视频、Render 和队列仍走普通画布生成链路。
- 自动生成节点通过 `origin` 与 `inheritedReferences` 绑定到分析节点。用户编辑提示词后必须保留
  `promptSource: "user"` / `promptLocked: true`；上游变化只标记 `needsUpdate`，不得自动重复计费。
- 旧项目加载路径必须保持幂等：先处理旧 `Video Remix` 容器，再把未迁移的 `videoRemixes[]`
  转为画布节点，并保存 `canvasMigrationVersion` 标记。

相关纯函数位于 `shared/videoAnalysis.js`，画布图构建位于
`src/features/video-analysis/remixGraphBuilder.ts`。改动运行时或持久化逻辑后，至少运行
`npm run typecheck`、相关回归测试和完整 `npm test`。

> **不要同时运行 `npm run dev` 和已安装的桌面应用。**
> 两者通过 AI Browser Hub 共用同一份登录 Profile 和 Chrome 实例。Hub 能保护浏览器
> 生命周期，但生成调度器和业务页面队列仍只在单个
> 后端进程内生效，跨进程不排队：
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

Flow、Gemini Web、即梦的 HTTP Provider 分层、并发策略、健康接口和真实冒烟方式见
[三平台生成运行时架构](generation-runtime-architecture.md)。日常 `npm test` 只跑脱敏协议
样本与合成压力测试，不访问三家平台、不产生额度。`npm run test:web-http:live` 默认也只列
计划，只有环境变量和 `--execute` 同时存在时才允许真实生成。

## 目录职责

- `src/`：React 画布
- `server/`：本地 API、生成流程和浏览器自动化
- `electron/`：桌面主进程与更新
- `shared/`：前后端共享规则
- `remotion/`：成片渲染
- `test/`：回归测试
- `library/`：本机用户项目和素材，不得作为源码清理对象

## 浏览器自动化

安装包不再携带 Chromium，而是内置版本固定的 AI Browser Hub 载荷。应用首次启动把 Hub
静默安装到当前用户目录，后续 App 复用并只升级、不降级。Hub 检测系统正式版 Google Chrome，
用共享 Profile 保存 Flow/Gemini Web/即梦登录态；应用更新与卸载不会覆盖。Remotion 仍直接
使用系统 Chrome 可执行文件，不会首次渲染时联网下载浏览器。

共享 Profile 位于 macOS 的 `~/Library/Application Support/SankaiAI/AI Browser Hub/data/profile-v1`
或 Windows 的 `%LOCALAPPDATA%\SankaiAI\AI Browser Hub\data\profile-v1`，不属于 Evan 的
`userData`。开发版、安装版、Reverse Prompt 及后续 App 都从 Hub 取得短期租约和动态 CDP，
禁止硬编码调试端口。`test/runtimePaths.test.mjs` 与独立 Hub 仓库测试负责守卫该边界。

Hub 依赖只在仓库根目录的 `browser-hub.lock.json` 锁定一次，包含稳定版版本、协议和三平台
SHA-256。`.github/workflows/sync-browser-hub.yml` 每六小时检查 Hub 最新稳定 Release；发现
兼容新版本后先在 macOS runner 下载锁定载荷并运行类型检查、构建和完整测试，全部通过才由
GitHub Actions 更新 `main`。普通构建只读取锁文件，不在构建过程中临时选择 `latest`。

## 媒体工具

FFmpeg `6.1.1` 与 FFprobe `6.1.1` 由锁定的 `ffmpeg-ffprobe-static` 平台包提供。源码模式
直接使用 `node_modules` 中的二进制；`npm run desktop:runtime` 会复制二进制与许可证信息，
桌面安装包从 `resources/media-tools/` 执行，不依赖系统 `PATH`。

Hub 只监听 `127.0.0.1` 随机控制端口，Chrome 也使用动态 CDP。每个任务持有带心跳的租约；
Evan 明确拥有的平台标签会注册给 Hub，任务结束后保温 30 秒，同一标签累计 50 次任务或
存活两小时后在任务边界重建。最后一个租约释放 60 秒后回收 Chrome。整个过程由租约事件
和单次到期定时器驱动，不运行周期性标签巡检。关闭 Evan 只释放本 App 的租约，不会中断其他 App。
用户主动登录时由 Hub 切换为无自动化参数的可见 Chrome，普通任务固定无头执行。

Windows 即梦生图优先复用系统共享 Chrome 中已经存在的即梦标签页，避免已有标签较多时
创建新 CDP target 长时间阻塞；读取生成结果时只选择实际可见的记录区，忽略响应式布局
同时渲染的隐藏副本。产品短视频的“取消队列”会通过 `AbortSignal` 立即终止本地 Ops CLI
等待并释放浏览器队列。平台已经接单的生成可能仍会在远端完成，取消后不得自动重复提交。

顶部栏“刷新画布”会先保存当前改动，再从项目文件重新加载当前画布，用于同步后台任务
状态而不丢失尚未自动保存的编辑。删除项目图片节点时先清除节点选中态，避免磁盘回收站
操作期间残留已删除节点的提示词控制面板；图片与同时选中的文字节点会作为同一批次删除。

节点连线的目标判定使用浏览器返回的真实屏幕边界，不得假设所有节点都是固定宽高。松手时
必须按当前指针位置重新解析目标，不能只依赖上一次异步 hover 状态；连接点附近保留少量
屏幕像素容错，以兼容 Windows 鼠标和触控板快速拖放。

自动生成通过 Hub 获取无头 Chrome。用户主动执行“打开共享 Chrome/登录”时才切换成无自动化
参数的可见实例；存在其他活动租约时 Hub 会拒绝切换，避免中断任务。登录完成后的检查由 Hub
优雅切回同一共享 Profile 的无头实例，业务 App 不直接结束 Chrome 进程。

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
