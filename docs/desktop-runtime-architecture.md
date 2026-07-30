# Evan 桌面运行时架构

状态：共享 AI Browser Hub 已落地
基线：每次从发布 Tag 对应的 commit 构建，不在文档中固定“最新 main”哈希。

## 1. 产品目标

最终用户安装 Evan 后，不需要自行安装 Node.js、Python、ffmpeg 或 Chrome Beta，但电脑
必须安装可自动更新的正式版 Google Chrome。首次打开即可使用画布、素材管理和本地渲染；
即梦、Gemini Web 与 Google Flow 只要求用户在系统共享 AI Browser Hub Profile 中各登录一次。

桌面版必须同时满足：

- 应用升级不覆盖项目、素材、密钥、浏览器登录态和未完成任务。
- 启动时探测系统 Chrome 的安装路径和最低兼容版本，不符合条件时阻断并引导安装或更新。
- 登录失效时进入可恢复状态，不把“需要登录”当成普通生成失败。
- 无法确认任务是否已提交时，不自动重试，避免重复消耗额度。
- `npm run dev` 保持可用，开发模式不强制安装 Electron 运行时。

## 2. 进程边界

```text
Electron 主进程
  ├─ Renderer：现有 React/Vite 画布
  ├─ Node 后端：Electron utilityProcess，绑定随机 loopback 端口
  └─ Python Automation Engine
       └─ 独立 Ops CLI + AI Browser Hub 租约客户端

AI Browser Hub（当前用户级共享运行时）
  └─ 系统 Google Chrome + 共享 Profile + 动态 CDP
```

正式安装版不依赖系统 `node` 或 Python。Ops CLI 仍冻结为平台独立可执行目录；Hub 自带
独立 Node 运行时，并由每个 App 的安装包内置载荷静默安装/升级。Python 与 Node 客户端
通过用户权限状态文件找到 Hub 的随机本机控制端口，再按任务申请租约。

### 2.1 关闭应用与生成中断

- macOS 与 Windows 关闭最后一个 Evan 窗口都会退出 Electron，并释放本 App 租约；不会
  关闭其他 App 正在使用的共享 Chrome。最后一个租约释放 60 秒后由 Hub 回收 Chrome。
- Hub 只管理业务 App 通过 `page.register` 明确登记的标签：任务后保温 30 秒、每个稳定
  `pageKey` 只复用一个标签，累计 50 次任务或存活两小时后在任务边界重建。未登记的登录页
  和用户页面永不自动关闭；生命周期检查只发生在 acquire/register/release 事件，不做周期轮询。
- 后台异常退出但 Electron 仍存活时，主进程会在一分钟窗口内最多自动重启三次，并让
  页面连接新的随机 loopback 地址；连续崩溃超过上限后才要求用户完整重启应用。
- 本地后端退出不会暂停远程平台任务。Flow/Gemini Web/即梦已经提交的任务可能继续在平台生成，
  但 Evan 当前的一次性自动化进程无法继续等待和下载；普通 API 请求通常直接中断。
- 画布重新连接后台时先检查本地结果文件。结果已落盘则恢复成功；结果尚未落盘且检测到
  后台启动时间晚于任务开始时间，则立即结束加载动画并提示检查平台历史记录，不自动重试。
- 当前已用无凭证任务日志记录提交边界和平台任务标识；重启后可以区分“尚未提交可安全
  重跑”和“已经提交需核对历史”。完整输入不落该日志，因此跨进程自动续接仍是后续能力；
  在无法确认提交结果前必须坚持“不自动重试”，避免重复扣费。

## 3. 目录边界

安装资源是只读、可替换的，用户数据是可写、跨版本保留的。

### 安装资源

由 `EVAN_RESOURCES_DIR` 指定，开发模式默认为仓库根目录：

- `dist/`
- `server/`
- `shared/`
- `remotion/`
- 内置 Python Worker
- ffmpeg / ffprobe

### 用户数据

由 `EVAN_DATA_DIR` 指定，开发模式为了兼容默认为仓库根目录。桌面版由 Electron
传入 `app.getPath('userData')` 下的 Evan 专用子目录。

- `library/`：项目、素材、工作流和持久化任务
- `logs/`：后端、自动化和渲染日志
- `runtime/`：临时状态与进程通信文件
- `codex-home/`：安装版可选 Codex 连接器的独立登录资料、配置和 Evan Skill

共享浏览器数据不在 `EVAN_DATA_DIR`：macOS 位于
`~/Library/Application Support/SankaiAI/AI Browser Hub/`，Windows 位于
`%LOCALAPPDATA%\SankaiAI\AI Browser Hub\`。其中 `data/profile-v1` 保存三平台登录态，
`install/versions` 保存可替换运行时。卸载单个 App 不删除该目录。

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

- `authenticated`：本次应用进程内的 provider 专用探针确认已进入编辑器或出现明确账号
  控件；历史状态、Cookie 文件存在或打开过登录页都不算。
- `expired`：明确跳转登录页、出现登录弹窗或 provider 返回认证失败。
- `browser_unavailable`：浏览器进程、运行时或 profile 不可用。
- `submission_unknown`：点击生成后连接中断，无法确认平台是否已接单。

### 4.2 过期恢复

应用启动时做轻量探针，任务提交前必须再次探针。执行中发现过期时：

1. 任务持久化为 `auth_required`，保存 provider、阶段、输入摘要和提交边界。
2. Electron 显示“重新登录”入口；只有用户主动操作时才打开同一个持久化 profile。
3. 用户完成登录后点击“检查登录状态”；探针关闭可见窗口、用同一 Profile 无头访问真实
   页面，只有取得 provider 明确登录证据才更新为 `authenticated`。
4. 仅在任务尚未进入提交边界时允许自动续跑。
5. 已点击生成但结果未知时进入 `submission_unknown`，必须先检查平台历史记录；
   未确认前不自动再次提交。

登录恢复不是“重装浏览器”或“清空 profile”。清空 profile 只能作为用户明确选择的
修复动作，并且必须提前提示会退出即梦和 Google Flow。

### 4.3 更新兼容

- 浏览器可执行文件由 Google Chrome 自身更新，共享 `profile-v1` 永不打入安装包、永不被更新覆盖。
- Evan 启动时读取 Chrome 版本；低于最低兼容版本时阻断运行并引导更新。
- macOS 缺少 Chrome 时显示阻断页并打开官方下载地址；Windows 安装器在安装前检查并阻止继续。
- provider 选择器规则单独带 schema/version，可随应用补丁更新。

Hub 控制面和 Chrome CDP 都使用随机 loopback 端口。状态文件含随机访问令牌并限制为当前
用户读取；App 不得硬编码 9222/19222，也不得直接拥有 Chrome 生命周期。

## 5. 持久化任务

所有三平台 HTTP 生成任务都记录提交边界：

- `queued` / `waiting`：已进入统一调度器，等待平台和全局提交通道。
- `preparing`：准备会话、工作区和参考素材，尚未触发平台生成。
- `submitting`：正在发送计费生成请求。
- `submitted`：平台已返回提交响应；随后进入 `polling` / `downloading`。
- `auth_required`：提交前发现登录失效，可在恢复后安全续跑。
- `submission_unknown`：提交期间连接中断，禁止自动重复提交。
- `interrupted`：应用退出时仍在提交前，可以安全重新执行。
- `recovery_required`：平台已经接单，轮询、下载、取消或重启中断，必须先核对历史。
- `completed` / `failed` / `cancelled`。

状态写入 `runtime/generation-jobs.json`，不含 Cookie、Token、提示词和素材内容。详细并发、
健康检查与恢复语义见[三平台生成运行时架构](generation-runtime-architecture.md)。

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

- 干净机器无 Node、Python、ffmpeg 时可以安装启动；Chrome 缺失时必须明确阻断并引导安装。
- 首次本地渲染不联网下载浏览器。
- Flow/Gemini Web/即梦首次登录后，重启与应用升级仍保持登录。
- 人为使登录失效后，应用能引导重新登录并安全恢复。
- 在生成提交瞬间强制关闭浏览器，不会自动重复扣额度。
- 升级不会删除或移动用户项目、素材、配置和登录 profile。
- 后端仅绑定 loopback 随机端口，不依赖固定 3001。
- Automation Engine 只连接 Hub 租约返回的动态 CDP，不连接日常 Chrome Profile 或 Chrome Beta。

## 9. 当前实施状态

已完成：

- Electron 主进程管理后端 utility process，并使用随机 loopback 端口。
- 程序资源、App 用户数据和系统共享浏览器数据三者分离。
- 系统 Chrome 兼容性探针、macOS 启动阻断页和 Windows 安装前检查已配置。
- Ops CLI 通过 PyInstaller 冻结，安装机不要求 Node、Python 或 Chrome Beta；正式版 Google Chrome 是唯一浏览器前置条件。
- FFmpeg `6.1.1` 与 FFprobe `6.1.1` 按平台打入安装资源，视频处理不依赖系统 PATH。
- Remotion 使用系统 Chrome 可执行文件，首次本地渲染不再下载额外浏览器。
- Flow/Gemini Web/即梦自动任务通过跨 App 租约复用同一无头 Chrome；真实跨语言联调已验证
  AI 画布 Python 与 Reverse Prompt Node 同时复用一个浏览器 PID。
- provider 登录状态持久化；认证过期只返回恢复提示，用户主动打开无自动化参数的共享 Chrome 后登录。
- Flow 新账号可从首页进入已有项目或自动创建项目。
- 三平台生图按统一模型能力表限制结果数量；Flow 最多 4 张、Gemini Web 1 张、即梦图片
  5.0 Pro 最多 4 张、5.0 Lite 最多 8 张。纯文生图水平排列，带参考素材时纵向排列并保留
  每张结果到参考素材的连接。
- 后台重启后，画布会先恢复已经落盘的结果；未落盘任务立即退出无限加载并进入安全提示，
  要求先检查平台历史记录再决定是否重新生成。
- macOS DMG/ZIP 与 Windows x64 NSIS 的原生构建脚本和 GitHub Actions 矩阵已配置。
- 版本 Tag 会自动创建 GitHub Release；发布成功后删除重复的 Actions 临时产物，只保留
  Release 中供下载和更新使用的安装文件。
- 构建前会清理并验收平台相关 Ops CLI 和 FFmpeg/FFprobe，避免跨平台混装。
- 品牌图标会从 `public/TwitCanva-logo.png` 生成 ICNS/ICO。
- 自动更新入口已接入，未配置发布源时安全禁用。
- Codex 连接器支持自动发现/手动选择本机 CLI、独立 `CODEX_HOME`、登录状态检测、重新
  登录、安装版 Skill/队列桥接；未安装或未登录时画布会禁用 Codex 模型并给出明确提示。

正式对外发布前仍需：

- 将受信任客户端目前使用的租约内 CDP 逐步收敛为 Hub 侧 provider/page RPC。
- 完成 `submission_unknown` 的平台历史记录核验与任务级安全续跑 UI。
- 完成 macOS Developer ID 签名/公证与 Windows Authenticode 代码签名。
- 配置生产更新源，并将现有安装器矩阵接入正式发布/签名凭证。
