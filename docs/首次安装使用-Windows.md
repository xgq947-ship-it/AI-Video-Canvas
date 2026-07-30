# Evan Windows 首次安装与使用

适用于 Windows 10/11 64 位普通用户。安装版已经内置 Electron 后端、Python 自动化
运行时、FFmpeg 和 FFprobe，不要求 Chrome Beta、Python 或 Node.js，但需要正式版 Google Chrome。

## 1. 安装

Windows 安装器名称：

```text
Evan AI Video Canvas-<版本>-win-x64.exe
```

1. 先安装或更新正式版 Google Chrome，再双击 Evan 安装器。未检测到 Chrome 时安装器会阻断并打开官方下载页。
2. 建议保留默认的当前用户安装目录；也可以在安装向导中修改。
3. 保留“创建桌面快捷方式”，完成后启动 Evan。

当前测试安装器未配置 Authenticode 代码签名。Windows SmartScreen 可能显示“Windows 已
保护你的电脑”，确认文件来自项目发布页后，点击“更多信息 → 仍要运行”。正式对外发布
前应配置可信代码签名证书。

不要把程序安装到网络磁盘或同步盘。默认本机目录对 Chrome profile、文件锁和自动更新
最可靠。

## 2. 第一次打开

应用会自动启动本地后端。Windows Defender 首次扫描 Ops CLI 和 FFmpeg 时，启动
可能比后续稍慢。

用户数据默认保存在：

```text
%APPDATA%\Evan AI Video Canvas\data\
```

主要目录：

- `library\`：项目与全部素材。
- `runtime\`：任务运行状态。
- `logs\`：本地日志。

安装升级和卸载程序默认不删除用户数据。

## 3. 登录 Google Flow、Gemini Web 和即梦

1. 打开 Evan 右上角“设置”。
2. 点击“打开共享 AI 浏览器”。
3. 登录：
   - Google Flow：`https://labs.google/fx/tools/flow`
   - Gemini Web：`https://gemini.google.com/app`
   - 即梦：`https://jimeng.jianying.com`
4. 登录完成后返回 Evan，点击“检查登录状态”。探针通过后才会显示“已验证”。

自动生成统一使用系统共享 Profile 的后台无头浏览器。同一电脑上的三开 AI App 登录一次
即可复用，Hub 已包含在安装包中，无需单独安装。登录过期时应用只显示提示；请主动从设置
再次打开共享 AI 浏览器完成登录。

## 4. 开始使用

1. 新建项目和图片/视频节点。
2. 新建项目时可在“存放位置”点击“选择文件夹”，将完整项目放到桌面、其他磁盘或工作目录；
   不选择时继续使用 Evan 默认目录。
3. 选择模型。
4. 配置提示词、比例、清晰度和生成数量。
5. 点击生成。

图片数量按模型能力限制：Flow 最多 4 张、Gemini Web 1 张、即梦图片 5.0 Pro 最多 4 张、
5.0 Lite 最多 8 张；第一张更新当前节点，其余结果在右侧创建无连线图片节点。

## 5. Windows 兼容说明

- 正式安装器只在 Windows x64 环境构建，包含 Windows 版 `.exe` 运行时；Chrome 使用系统正式版。
- 自定义项目位置通过 Windows 目录 junction 映射到应用素材服务，不需要管理员权限；
  项目使用期间不要移动、重命名所选项目文件夹或断开所在磁盘。
- 应用与 Hub 都只监听 `127.0.0.1` 随机端口，不占用固定 9222/19222。
- 如果安全软件拦截 `evan-ops-cli.exe`、系统 `chrome.exe`、`ffmpeg.exe`，浏览器模型或渲染
  会不可用。应从可信发布源重新下载并允许这些安装目录内的程序。
- 不建议同时启动多个 Evan 实例；应用具有单实例锁，第二次启动会聚焦已有窗口。

## 6. 可选：连接 Codex CLI

Codex 只用于画布中的可选 Codex 模型。Evan 不内置固定版本，以免安装包中的 CLI 很快
过期；普通画布、Flow/Gemini Web/即梦和本地渲染不受影响。

1. 按 OpenAI 当前官方方式在 Windows 安装或更新 Codex CLI。
2. 打开 Evan“设置 → Codex 服务”。
3. 应用会自动检测 `%APPDATA%\npm\codex.cmd` 等常见位置。未检测到时点击“选择 Codex”，
   选择 `codex.exe`、`codex.cmd` 或 `codex.bat`。
4. 点击“登录 ChatGPT”，在系统浏览器中完成登录。
5. 回到设置点击“刷新”，状态变为“已连接”后即可使用。

Evan 安装版使用 `%APPDATA%\Evan AI Video Canvas\data\codex-home\` 保存独立登录资料和
画布 Skill，不改动用户全局 Codex 配置。CLI 仍由用户自行更新；如果更新改变了可执行
文件位置，只需重新“选择 Codex”。登录过期时重新点击“登录 ChatGPT”。

## 7. 更新与卸载

- 更新：运行新版安装器覆盖安装，项目和浏览器登录状态保留。
- 关闭 Evan 主窗口只退出 Evan；共享 Chrome 在所有 App 都空闲 60 秒后自动关闭。
- 卸载：Windows“设置 → 应用 → 已安装的应用”中卸载 Evan。
- 完全删除数据：卸载后手动删除
  `%APPDATA%\Evan AI Video Canvas\`。

删除数据目录前务必备份 `data\library\`。

## 8. 常见问题

| 现象 | 处理 |
|---|---|
| SmartScreen 拦截 | 当前测试包未签名；确认来源后选择“更多信息 → 仍要运行”。 |
| Flow/Gemini Web/即梦需要登录 | 设置 → 打开共享 AI 浏览器，登录后重试。 |
| 生成时没有浏览器窗口 | 正常，生成默认在后台无头运行。 |
| 浏览器模型一直不可用 | 更新 Google Chrome，并检查 Defender/安全软件是否隔离 Ops CLI。 |
| Codex 模型是灰色 | 安装/更新 Codex CLI，在“设置 → Codex 服务”选择 `codex.exe`/`.cmd` 并登录。 |
| Codex 登录过期 | 在 Codex 服务中再次点击“登录 ChatGPT”，完成后刷新。 |
| 自定义项目路径不可用 | 确认磁盘在线、目录可写，且安全软件没有阻止 Evan 创建目录 junction。 |
| 启动后后端报错 | 退出 Evan，确认任务管理器中没有残留 Evan，再重新启动并查看 `logs\`。 |
| 共享浏览器启动失败 | 完全退出相关三开 AI App 后重试；仍失败时保留 Hub 日志并反馈。 |
