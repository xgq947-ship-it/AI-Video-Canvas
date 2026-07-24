# AI 项目接手规则

开始修改前必须阅读：

- `README.md`
- `docs/项目说明.md`
- `docs/development.md`
- `docs/desktop-runtime-architecture.md`
- `docs/发布与跨电脑开发.md`

关键约束：

- 最终用户使用自包含 Electron 安装包，不得重新引入系统 Chrome、Chrome Beta、Node、
  Python 或 FFmpeg 作为运行前置条件。
- Codex 是可选连接器：不得把固定版本 Codex CLI 打入安装包或锁进项目依赖。运行时使用
  用户单独安装/更新的 CLI；Evan 仅管理应用专用 `CODEX_HOME`、Skill、队列桥接和状态 UI。
- Flow/即梦自动生成默认使用 Evan 内置 Chromium 无头运行；只有用户主动登录或调试时
  才显示浏览器。
- 用户项目、素材、密钥和 `browser-profile` 属于持久化用户数据，升级和普通卸载不得
  覆盖或清理。
- macOS 与 Windows 运行时必须在对应原生 runner 构建，不得跨平台复用二进制。
- 正式发布由 `vX.Y.Z` Tag 触发；工作流创建 GitHub Release 后自动删除 Actions 临时
  产物，不得长期保留重复安装文件。
- 不得提交本机生成的 `node_modules/`、`dist/`、`release/`、`desktop-runtime/`、
  Python 虚拟环境、内置浏览器、日志、登录资料或用户素材。
- 修改发布、运行时、浏览器或项目持久化逻辑时必须添加或更新回归测试，并运行完整
  `npm test`。
