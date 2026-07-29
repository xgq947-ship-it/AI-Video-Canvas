# AI 项目接手规则

开始修改前必须阅读：

- `README.md`
- `docs/项目说明.md`
- `docs/development.md`
- `docs/desktop-runtime-architecture.md`
- `docs/发布与跨电脑开发.md`

关键约束：

- 最终用户使用 Electron 安装包，不得引入 Node、Python、FFmpeg 或 Chrome Beta 作为
  运行前置条件；这些仍由安装包自带。
- **正式版 Google Chrome（≥ `MIN_SUPPORTED_CHROME_MAJOR`，见
  `server/runtime/browserExecutable.js`）是唯一允许的外部前置条件。** 安装包不再自带
  Chromium：Google 会把 Chrome for Testing 判定为不安全浏览器而拒绝登录，Flow/即梦
  因此必须使用用户电脑上的正式版 Chrome。macOS 首次启动缺少 Chrome 时显示阻断页，
  Windows 安装器直接 `Abort`。改动这条前先确认登录链路仍可用。
- Codex 是可选连接器：不得把固定版本 Codex CLI 打入安装包或锁进项目依赖。运行时使用
  用户单独安装/更新的 CLI；Evan 仅管理应用专用 `CODEX_HOME`、Skill、队列桥接和状态 UI。
- Flow/Gemini Web/即梦默认通过 AI Browser Hub 共用一个无头 Chrome 和共享 Profile；
  开发版、安装版、Reverse Prompt 及后续兼容 App 复用同一登录态。它绝不读取或影响
  用户日常 Chrome 的 Profile。只有用户主动登录时才显示窗口，登录实例不带 CDP、
  headless 或 automation 参数。
- 用户项目、素材、密钥和 AI Browser Hub 的共享 Profile 都是持久化用户数据。业务 App
  升级和普通卸载不得覆盖、迁移或清理共享 Profile，也不得直接关闭共享 Chrome。
- macOS 与 Windows 运行时必须在对应原生 runner 构建，不得跨平台复用二进制。
- 正式发布由 `vX.Y.Z` Tag 触发；工作流创建 GitHub Release 后自动删除 Actions 临时
  产物，不得长期保留重复安装文件。
- 不得提交本机生成的 `node_modules/`、`dist/`、`release/`、`desktop-runtime/`、
  Python 虚拟环境、内置浏览器、日志、登录资料或用户素材。
- 修改发布、运行时、浏览器或项目持久化逻辑时必须添加或更新回归测试，并运行完整
  `npm test`。
