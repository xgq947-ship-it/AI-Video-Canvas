# Evan 桌面运行时架构

状态：安装版第一阶段已落地
基线：每次从发布 Tag 对应的 commit 构建，不在文档中固定“最新 main”哈希。

## 1. 产品目标

最终用户安装 Evan 后，不需要自行安装 Node.js、Python、ffmpeg、Chrome 或 Chrome Beta。
首次打开即可使用画布、素材管理和本地渲染；即梦与 Google Flow 只要求用户在 Evan
管理的专用浏览器中各登录一次。

桌面版必须同时满足：

- 应用升级不覆盖项目、素材、密钥、浏览器登录态和未完成任务。
- 浏览器版本与 Playwright 版本锁定并作为一个兼容单元发布。
- 登录失效时进入可恢复状态，不把“需要登录”当成普通生成失败。
- 无法确认任务是否已提交时，不自动重试，避免重复消耗额度。
- `npm run dev` 保持可用，开发模式不强制安装 Electron 运行时。

## 2. 进程边界

```text
Electron 主进程
  ├─ Renderer：现有 React/Vite 画布
  ├─ Node 后端：Electron utilityProcess，绑定随机 loopback 端口
  └─ Python Automation Engine
       └─ 当前：独立 Ops CLI + 应用专用 CDP 端口（迁移兼容层）
       └─ 目标：常驻 Worker + Playwright persistent context
            └─ Evan 内置 Chromium
```

第一阶段允许 Node 后端继续以现有入口启动，但正式安装版不得依赖系统 `node` 命令。
第一阶段已经把 Ops CLI 冻结为平台独立可执行目录，安装机不依赖系统 Python。当前仍以
一次性进程连接应用专用 CDP 端口；下一阶段迁移为常驻 Worker 后移除 CDP 兼容层。

### 2.1 关闭应用与生成中断

- macOS 只关闭最后一个窗口时 Electron 进程和本地后端继续运行；从 Dock 退出、按
  `Command+Q`、安装更新或强制结束进程才会停止后台。
- Windows 关闭最后一个窗口会退出 Electron，并同时请求本地后端优雅关闭。
- 后台异常退出但 Electron 仍存活时，主进程会在一分钟窗口内最多自动重启三次，并让
  页面连接新的随机 loopback 地址；连续崩溃超过上限后才要求用户完整重启应用。
- 本地后端退出不会暂停远程平台任务。Flow/即梦已经提交的任务可能继续在平台生成，
  但 Evan 当前的一次性自动化进程无法继续等待和下载；普通 API 请求通常直接中断。
- 画布重新连接后台时先检查本地结果文件。结果已落盘则恢复成功；结果尚未落盘且检测到
  后台启动时间晚于任务开始时间，则立即结束加载动画并提示检查平台历史记录，不自动重试。
- 任务级自动续接仍以第 5 节的持久化任务状态机为目标；在无法确认提交边界前必须坚持
  “不自动重试”，避免重复扣费。

## 3. 目录边界

安装资源是只读、可替换的，用户数据是可写、跨版本保留的。

### 安装资源

由 `EVAN_RESOURCES_DIR` 指定，开发模式默认为仓库根目录：

- `dist/`
- `server/`
- `shared/`
- `remotion/`
- 内置 Python Worker
- 内置浏览器
- ffmpeg / ffprobe

### 用户数据

由 `EVAN_DATA_DIR` 指定，开发模式为了兼容默认为仓库根目录。桌面版由 Electron
传入 `app.getPath('userData')` 下的 Evan 专用子目录。

- `library/`：项目、素材、工作流和持久化任务
- `logs/`：后端、自动化和渲染日志
- `browser-profile/`：即梦与 Flow 的持久化登录态
- `runtime/`：临时状态与进程通信文件
- `codex-home/`：安装版可选 Codex 连接器的独立登录资料、配置和 Evan Skill

大体积素材目录后续允许用户迁移，但浏览器 profile 和配置不跟随素材目录迁移。

## 4. 浏览器与登录态

### 4.1 状态机

每个 provider 独立维护以下状态：

```text
unknown
  -> checking
  -> authenticated
  -> expired
  -> reauthenticating
  -> authenticated

任何状态 -> browser_unavailable
任何执行中状态 -> submission_unknown
```

- `authenticated`：provider 专用探针确认已进入编辑器，而不只是 Cookie 文件存在。
- `expired`：明确跳转登录页、出现登录弹窗或 provider 返回认证失败。
- `browser_unavailable`：浏览器进程、运行时或 profile 不可用。
- `submission_unknown`：点击生成后连接中断，无法确认平台是否已接单。

### 4.2 过期恢复

应用启动时做轻量探针，任务提交前必须再次探针。执行中发现过期时：

1. 任务持久化为 `auth_required`，保存 provider、阶段、输入摘要和提交边界。
2. Electron 显示“重新登录”入口；只有用户主动操作时才打开同一个持久化 profile。
3. 用户完成登录后重新提交，provider 探针确认恢复并更新为 `authenticated`。
4. 仅在任务尚未进入提交边界时允许自动续跑。
5. 已点击生成但结果未知时进入 `submission_unknown`，必须先检查平台历史记录；
   未确认前不自动再次提交。

登录恢复不是“重装浏览器”或“清空 profile”。清空 profile 只能作为用户明确选择的
修复动作，并且必须提前提示会退出即梦和 Google Flow。

### 4.3 更新兼容

- 浏览器可执行文件随应用更新，`browser-profile/` 永不打入安装包、永不被更新覆盖。
- Playwright 与浏览器版本精确锁定，升级时作为一个 Automation Engine 发布。
- 浏览器大版本升级前备份 profile 元数据；升级失败时允许回滚 Engine，不回滚用户数据。
- provider 选择器规则单独带 schema/version，可随应用补丁更新。

当前兼容阶段使用应用专用端口 `19222` 并校验占用进程的 profile；不会再连接旧的
Chrome Beta 9222。常驻 Worker 完成后将不再暴露固定 CDP 端口。

## 5. 持久化任务

所有可能产生费用的生成任务必须记录提交边界：

- `prepared`：参数和素材已准备，尚未触发平台生成。
- `submitting`：正在点击/发送生成请求。
- `submitted`：已获得平台任务、项目或会话标识。
- `auth_required`：提交前发现登录失效，可在恢复后安全续跑。
- `submission_unknown`：提交期间连接中断，禁止自动重复提交。
- `completed` / `failed` / `cancelled`。

临时素材在任务结束前不得删除；应用重启后应能从持久化任务恢复。

## 6. 更新与数据迁移

- 版本号以 `package.json` 为唯一来源，发布由 `vX.Y.Z` Tag 触发。
- 更新只替换安装资源，不直接写用户数据。
- 数据结构使用独立 `schemaVersion`，迁移必须可重复、原子写入并先备份。
- 不在用户机器保存私有 GitHub Token；更新源使用公开下载端点或自有对象存储。
- macOS 正式包必须签名并公证，Windows 正式包应进行 Authenticode 签名。
- 应用、Automation Engine 和数据 schema 维护兼容性清单。

## 7. AI CLI 边界

- Codex / Claude 不作为应用启动和本地渲染的前置条件。
- Codex 作为可选高级连接器；CLI 可执行文件由用户单独安装和持续更新，安装包不得捆绑
  固定 Codex 版本。
- 启动时依次读取用户明确选择的路径、常见系统安装位置和 `PATH`；不可用时只禁用 Codex
  模型，不影响其他功能。
- 安装版使用应用专用 `CODEX_HOME`，自动安装版本化的 Evan Skill 和队列桥接命令，不
  依赖或修改用户全局 Skill；源码模式保留开发者现有 `CODEX_HOME`。
- Codex 登录由设置页显式触发，认证过期后允许重新登录；认证资料不得通过本地 API 返回。
- Claude 第一版优先使用 API/SDK；是否分发 Claude Code 需单独完成商业条款审查。
- CLI 登录失效与浏览器 provider 一样返回结构化 `auth_required`，不得只输出终端报错。

## 8. 发布前硬性验收

- 干净机器无 Node、Python、Chrome、ffmpeg 时可以安装启动。
- 首次本地渲染不联网下载浏览器。
- 即梦/Flow 首次登录后，重启与应用升级仍保持登录。
- 人为使登录失效后，应用能引导重新登录并安全恢复。
- 在生成提交瞬间强制关闭浏览器，不会自动重复扣额度。
- 升级不会删除或移动用户项目、素材、配置和登录 profile。
- 后端仅绑定 loopback 随机端口，不依赖固定 3001。
- Automation Engine 不连接系统 Chrome/Beta；CDP 兼容阶段仅使用并校验应用专用端口。

## 9. 当前实施状态（0.1.0 架构基线）

已完成：

- Electron 主进程管理后端 utility process，并使用随机 loopback 端口。
- 程序资源和用户数据分离，浏览器 profile 与项目数据不会被升级覆盖。
- Playwright `1.61.0` 与 Chrome for Testing `149.0.7827.55` 成对锁定并打包。
- Ops CLI 通过 PyInstaller 冻结，安装机不要求 Node、Python 或 Chrome Beta。
- FFmpeg `6.1.1` 与 FFprobe `6.1.1` 按平台打入安装资源，视频处理不依赖系统 PATH。
- Remotion 复用 Evan 内置 Chromium，首次本地渲染不再下载额外浏览器。
- Flow/即梦自动任务强制使用同一 profile 的无头 Chromium，生成时不弹窗或抢焦点。
- provider 登录状态持久化；认证过期只返回恢复提示，用户主动打开内置浏览器后登录。
- Flow 新账号可从首页进入已有项目或自动创建项目。
- Flow/即梦生图支持 1—4 张批量结果；纯文生图水平排列，带参考素材时纵向排列并保留
  每张结果到参考素材的连接。
- 后台重启后，画布会先恢复已经落盘的结果；未落盘任务立即退出无限加载并进入安全提示，
  要求先检查平台历史记录再决定是否重新生成。
- macOS DMG/ZIP 与 Windows x64 NSIS 的原生构建脚本和 GitHub Actions 矩阵已配置。
- 版本 Tag 会自动创建 GitHub Release；发布成功后删除重复的 Actions 临时产物，只保留
  Release 中供下载和更新使用的安装文件。
- 构建前会清理并验收平台相关 Ops CLI、Chromium 和 FFmpeg/FFprobe，避免跨平台混装。
- 品牌图标会从 `public/TwitCanva-logo.png` 生成 ICNS/ICO。
- 自动更新入口已接入，未配置发布源时安全禁用。
- Codex 连接器支持自动发现/手动选择本机 CLI、独立 `CODEX_HOME`、登录状态检测、重新
  登录、安装版 Skill/队列桥接；未安装或未登录时画布会禁用 Codex 模型并给出明确提示。

正式对外发布前仍需：

- 把一次性 Ops CLI/CDP 兼容层迁移为常驻 Python Worker。
- 完成 `submission_unknown` 的平台历史记录核验与任务级安全续跑 UI。
- 完成 macOS Developer ID 签名/公证与 Windows Authenticode 代码签名。
- 配置生产更新源，并将现有安装器矩阵接入正式发布/签名凭证。
