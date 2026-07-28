# Evan macOS 首次安装与使用

适用于普通使用者。安装版不要求安装 Node.js、Python、FFmpeg 或 Chrome Beta，但需要正式版 Google Chrome。
Codex CLI 只用于可选的“Codex 生图”等能力，不影响普通画布、Flow/Gemini Web/即梦或本地渲染。

## 1. 安装

当前 macOS 安装介质为 Apple Silicon（M1/M2/M3/M4）版本：

```text
Evan AI Video Canvas-<版本>-mac-arm64.dmg
```

1. 双击 `.dmg`。
2. 将 `Evan AI Video Canvas` 拖入“应用程序”。
3. 从“应用程序”中启动 Evan。

当前本地测试包未做 Apple Developer ID 签名和公证。首次打开若被 macOS 拦截：

1. 在 Finder 中按住 Control 点击 Evan，选择“打开”；或
2. 打开“系统设置 → 隐私与安全性”，在安全提示下选择“仍要打开”。

正式对外分发前应使用 Developer ID 签名并完成 Apple 公证，届时不会需要以上绕过步骤。

## 2. 第一次打开

应用会先检查 Google Chrome。未安装时会显示阻断页面并打开官方下载地址；安装完成后点击
“安装完成，重新检测”即可继续。Chrome 可用后，应用自动启动本地后端。

应用数据默认保存在：

```text
~/Library/Application Support/Evan AI Video Canvas/data/
```

其中：

- `library/`：项目、图片、视频、音频和渲染成片。
- `browser-profile/`：Google Flow、Gemini Web 与即梦登录状态。
- `runtime/`：自动化运行状态。
- `logs/`：本地日志。

更新或替换应用程序不会覆盖这些数据。

## 3. 登录 Google Flow、Gemini Web 和即梦

1. 打开画布右上角“设置”。
2. 选择“打开 Evan 专属 Chrome”。
3. 在该浏览器中访问并登录：
   - Google Flow：`https://labs.google/fx/tools/flow`
   - Gemini Web：`https://gemini.google.com/app`
   - 即梦：`https://jimeng.jianying.com`
4. 登录完成后回到 Evan，点击“检查登录状态”。探针通过后才会显示“已验证”。

登录资料只保存在 Evan 独立 Profile，不读取日常 Chrome 登录资料。日常生图、生视频使用
同一 Profile 的后台无头实例；如果登录过期，再从设置中打开 Evan 专属 Chrome。

## 4. 开始使用

1. 新建项目。
2. 在“存放位置”中保留 Evan 默认目录，或点击“选择文件夹”放到桌面、其他磁盘等位置。
   Evan 会在所选位置下创建一个与项目同名的完整项目文件夹。
3. 新建图片或视频节点。
4. 选择 Google Flow、Gemini Web、即梦或已经配置密钥的 API 模型。
5. 输入提示词、画面比例、分辨率及生成数量。
6. 点击生成。

图片数量按模型能力限制：Flow 最多 4 张、Gemini Web 1 张、即梦图片 5.0 Pro 最多 4 张、
5.0 Lite 最多 8 张。第一张写回当前节点，其余图片在右侧水平创建独立节点，不自动添加连接线。

## 5. 可选配置

- Flow、Gemini Web 与即梦使用用户自己的账号、权限和额度；即梦图片 5.0 Lite 当前不消耗额度。
- Gemini、OpenAI、火山方舟等 API 能力需要在设置中填写对应密钥。
- Codex/Claude 仅用于可选的高级编排能力，不影响应用启动、浏览器生成或本地渲染。

### 可选：连接 Codex CLI

Evan 不内置固定版本的 Codex。要使用画布中的 Codex 模型：

1. 按 OpenAI 当前官方方式在本机安装或更新 Codex CLI。
2. 打开 Evan“设置 → Codex 服务”。
3. Evan 会自动检测常见安装位置；未检测到时点击“选择 Codex”并选择本机可执行文件。
4. 点击“登录 ChatGPT”，在系统浏览器中完成登录。
5. 回到设置点击“刷新”。显示“已连接”后即可使用。

Evan 为安装版创建独立的 `CODEX_HOME`，登录资料和画布 Skill 保存在应用数据目录，不会
修改用户全局 `~/.codex`。Codex CLI 本身仍由用户单独更新，更新后路径不变时无需重新
配置；登录过期时再次点击“登录 ChatGPT”即可。

## 6. 卸载和更新

- 更新：安装新版并覆盖“应用程序”中的旧版，用户数据和登录资料保留。
- 关闭 Evan 主窗口会退出应用并关闭 Evan 专属 Chrome，不会关闭日常 Chrome。
- 卸载程序：删除“应用程序”中的 Evan。
- 完全删除数据：卸载后再手动删除
  `~/Library/Application Support/Evan AI Video Canvas/`。

删除数据目录会永久移除项目、素材和登录状态，请先备份。

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| macOS 提示无法验证开发者 | 当前测试包未签名，按“安装”章节从隐私与安全性允许。 |
| Flow/Gemini Web/即梦提示需要登录 | 设置 → 打开 Evan 专属 Chrome，登录对应网站后重试。 |
| 生成时没有浏览器窗口 | 正常，自动生成默认后台无头运行。 |
| 想查看浏览器执行情况 | 主动打开 Evan 专属 Chrome 用于登录/调试；不要在任务提交过程中切换浏览器模式。 |
| Codex 模型是灰色 | 安装/更新 Codex CLI，然后在“设置 → Codex 服务”选择路径并登录。 |
| Codex 提示登录过期 | “设置 → Codex 服务 → 登录 ChatGPT”，完成后刷新状态。 |
| 自定义项目文件夹无法创建 | 确认所选磁盘已连接、文件夹有写入权限，且其中不存在同名项目文件夹。 |
| 本地渲染失败 | 查看应用数据目录的 `logs/`，确认源素材仍存在。 |
