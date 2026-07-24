# Evan 开发指南

最终用户使用 Electron 安装包，不需要自行安装 Node、Python、Chrome 或 Chrome Beta。
本页只面向修改源码和制作安装包的开发者。

## 环境

- Node.js 22+
- Python 3.11+（推荐 3.12）

```bash
npm install
npm run setup
```

`npm install` 会安装项目锁定的原生 FFmpeg / FFprobe，开发机不需要再通过 Homebrew 安装。

需要调试 Google Flow、即梦或执行 Remotion 本地渲染时，再安装锁定的 Python/Chromium
运行时：

```bash
npm run setup:browser-models
```

这条命令会创建 `server/python/.venv/`，并下载与 Playwright 精确匹配的 Chromium 到
`server/python/.browsers/`。两者均为本机生成目录，不进入 Git。

## 日常开发

```bash
npm start       # 推荐：打开完整 Electron 桌面应用，后端自动启动
npm run dev
npm test
npm run build
```

开发服务器使用前端 `5173`、后端 `3001`。桌面版后端由 Electron 分配随机 loopback
端口，不使用这两个固定端口。

## 桌面应用

```bash
npm run desktop:dev      # 构建前端并启动 Electron
npm run desktop:icons    # 从品牌 PNG 生成当前平台安装图标
npm run desktop:runtime  # 冻结独立 Ops CLI/Python 运行时
npm run desktop:verify   # 验收 Ops CLI、Chromium、FFmpeg/FFprobe
npm run desktop:pack     # 生成未签名的应用目录
npm run desktop:dist:mac # 仅在 macOS：DMG + ZIP
npm run desktop:dist:win # 仅在 Windows x64：NSIS EXE
```

生成目录 `dist/`、`desktop-runtime/`、`release/` 都可安全删除并重新构建。

`desktop:runtime` 每次先清理旧的目标目录，防止 macOS 的 Mach-O/Chromium/FFmpeg
残留进入 Windows 包，反之亦然。平台相关 Python、Chromium、媒体工具必须在目标系统
原生生成；不要在 macOS 上把 `electron-builder --win` 生成的壳包当作正式 Windows
安装包。

仓库的 `.github/workflows/desktop-installers.yml` 支持手动触发或 `v*` Tag 触发，分别在
`macos-latest`（arm64）和 `windows-latest`（x64）runner 构建安装介质。`v*` Tag
构建会在两个平台均成功后创建 GitHub Release，随后删除 Actions 中用于跨 Job 传递的
临时产物；临时产物的 1 天保留期只用于发布失败兜底。

版本发布、跨电脑接手和存储边界见
[发布与跨电脑开发](发布与跨电脑开发.md)。不要把 `release/`、`desktop-runtime/`、
Python 虚拟环境、内置浏览器或 `node_modules/` 提交进 Git。

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

安装包内置 Chromium；登录资料位于用户数据目录的 `browser-profile/`，应用更新不会覆盖。
Playwright 和 Chromium 必须作为一个兼容单元升级，不能只升级其中一个。Remotion 渲染
复用这一份内置 Chromium，不会首次渲染时额外联网下载浏览器。

## 媒体工具

FFmpeg `6.1.1` 与 FFprobe `6.1.1` 由锁定的 `ffmpeg-ffprobe-static` 平台包提供。源码模式
直接使用 `node_modules` 中的二进制；`npm run desktop:runtime` 会复制二进制与许可证信息，
桌面安装包从 `resources/media-tools/` 执行，不依赖系统 `PATH`。

当前迁移兼容层使用应用专用 CDP 端口 `19222`，且会校验 profile 所属进程，不会连接系统
Chrome。常驻 Worker 完成后将移除该固定端口。

自动生成显式启动无头 Chromium。用户主动执行“打开内置浏览器/登录”才会切换成可见实例；
后端不设置全局强制弹窗变量。

## 可选 AI CLI / MCP

Codex 和 Claude 不属于安装版的必需依赖。源码开发需要测试 Claude Code 本地剪辑编排时：

```bash
npm run mcp:claude
```

MCP 支持读取画布、分析配音、生成并应用剪辑计划以及触发 Remotion 预览；应用剪辑计划
必须显式确认且创建副本，不修改源画布。
