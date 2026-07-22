# Windows 首次配置指南

> **这份文档是写给 AI 助手执行的。** 如果你是 AI，请从上往下逐步执行，
> **每一步都要跑「验收」命令确认通过再进入下一步**，不要跳步、不要合并步骤。
> 遇到验收不通过，先看该步的「排错」小节；仍解决不了就停下来，把命令、
> 完整报错、以及你所在的步骤编号告诉用户，不要自己发明替代方案。

**目标**：在一台全新的 Windows 电脑上，把这个项目从零跑起来。

**重要前提**：本项目此前只在 macOS 上验证过。Windows 适配的代码已经写好，
但**没有在真实 Windows 上跑通过**。所以遇到报错是预期内的——请把报错完整
记录下来反馈，由 Mac 那边修复后推送，你再 `git pull` 继续。

---

## ⚠️ 开始前必读：两个环境前提

下面每一步都默认 **winget 可用** 且 **网络通畅**。实际机器上这两条经常不成立，
先看清楚，别照着理想剧本走到一半卡死。

### 前提 A — winget 可能不可用

`winget` 是 Windows 包管理器，但**不是所有机器都有**：
Win10 较旧版本、精简版系统、或没装「应用安装程序」的机器上都没有。

先确认：
```powershell
winget --version
```

**能打印版本号** → 后面的 `winget install` 都能用。

**提示不是内部或外部命令** → 你有两条路：

1. **装上它**：微软商店搜索「应用安装程序 / App Installer」安装，然后新开窗口重试
2. **全部改用手动下载**（本文档每一步都给了官网下载地址，见各步骤的「方式二」）

> 手动安装同样能跑通，只是要自己去官网下载安装包。
> **不要因为没有 winget 就停下**——照着各步骤的手动方式做即可。

### 前提 B — 网络可能受限

GitHub、Google、npm、PyPI 在国内网络下经常**下载慢、中断、或直接被拦**。
这不是配置错误，是网络环境问题。

通用应对：

| 情况 | 处理 |
|---|---|
| 下载中断/超时 | **直接重试**，多试几次往往就通了。不要改配置 |
| `npm install` 卡住或失败 | 换淘宝镜像：`npm config set registry https://registry.npmmirror.com` |
| `pip install` 超时 | 加清华镜像参数，见步骤 10 的排错 |
| GitHub clone 失败 | 重试；仍不行让用户开代理，或改用 SSH 方式 |
| 官网下载页打不开 | 需要代理。这一步没有替代方案，必须能访问 |

> **给 AI 助手**：遇到网络类失败，**先重试 2–3 次**再判定为失败。
> 反馈时请注明是"网络问题"还是"配置问题"——这两类的处理方式完全不同。

---

## 术语：两条轨道

| | 轨道 A | 轨道 B |
|---|---|---|
| 模型 | Gemini、OpenAI、**Seedance 2.0 (ARK)** | 即梦 Seedance、Google Flow |
| 原理 | 调官方 HTTP API | 驱动一个**你手动登录过的 Chrome** |
| 需要 | 填 API 密钥 | Python + Playwright + Chrome + **自己的会员账号** |
| 难度 | 简单 | 复杂，问题多发 |

**必须先把轨道 A 跑通，再做轨道 B。** 轨道 A 不通就去搞轨道 B，只会把两类
问题混在一起，排查难度翻倍。

如果只需要「能出片」，**轨道 A 就够了**：`Seedance 2.0 (ARK)` 和
`即梦 Seedance 2.0` 是同一个模型，只是前者按量付费、后者吃 VIP 会员额度。

---

# 第一部分：轨道 A（必做）

## 步骤 1 — 安装 Git

**方式一：winget**
```powershell
winget install --id Git.Git -e
```

**方式二：手动下载**（没有 winget 时用）
1. 打开 https://git-scm.com/download/win
2. 下载 64-bit 安装包，双击安装，**一路默认**即可

装完**必须新开一个 PowerShell 窗口**（PATH 变更不会影响已打开的窗口）。

**验收**
```powershell
git --version
```
能打印版本号即通过。

---

## 步骤 2 — 安装 Node.js（必须 22 或更高）

**方式一：winget**
```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

**方式二：手动下载**（没有 winget 时用）
1. 打开 https://nodejs.org/zh-cn/download
2. 选 **LTS**、Windows、`.msi` 安装包
3. 双击安装，一路默认（会自动加入 PATH）

新开 PowerShell 窗口。

**验收**
```powershell
node --version
npm --version
```

**`node --version` 必须 ≥ v22.0.0。**

> **为什么卡这个版本**：`npm test` 用的是 `node --test test/*.test.mjs`。
> Windows 的 cmd/PowerShell **不会展开** `*` 通配符，靠的是 Node 自己展开——
> 这个能力 Node 21 才有。装了 Node 20 会出现"测试一个都跑不了"且看不出原因。

**排错**：如果版本低于 22，去 https://nodejs.org/ 下载 LTS 安装包手动安装。

---

## 步骤 3 — 安装 ffmpeg（渲染出片必需）

**方式一：winget**
```powershell
winget install --id Gyan.FFmpeg -e
```

**方式二：手动下载**（没有 winget 时用）
1. 打开 https://www.gyan.dev/ffmpeg/builds/
2. 下载 **release essentials** 的 7z/zip 包
3. 解压到一个固定位置，例如 `C:\ffmpeg`
4. 把里面的 **`bin` 目录**（如 `C:\ffmpeg\bin`）加入系统环境变量 PATH：
   Win 键搜索「环境变量」→ 编辑系统环境变量 → 环境变量 → 选中 Path → 编辑 → 新建 → 粘贴路径
5. **新开** PowerShell

新开 PowerShell 窗口。

**验收**
```powershell
ffmpeg -version
ffprobe -version
```

两条都要能打印版本号。

**排错**：如果提示"不是内部或外部命令"，说明 PATH 没配好：
1. 找到 ffmpeg 的 `bin` 目录（winget 装的通常在
   `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg...\ffmpeg-*\bin`）
2. 把该目录加入系统环境变量 PATH
3. **新开** PowerShell 再验收

---

## 步骤 4 — 拉取代码

选一个**纯英文路径**的目录（避免中文路径带来的编码问题）：

```powershell
cd C:\Users\%USERNAME%\Documents
git clone https://github.com/xgq947-ship-it/AI-Video-Canvas.git
cd AI-Video-Canvas
```

> 这是**私有仓库**。如果提示需要登录，让用户在浏览器完成 GitHub 授权，
> 或用 `gh auth login`。**不要把用户的密码或 token 写进任何文件或命令行里。**

**验收**
```powershell
git log --oneline -1
dir
```
能看到最新 commit，且目录下有 `package.json`、`server`、`src`。

---

## 步骤 5 — 安装 Node 依赖

```powershell
npm install
```

这一步会下载 Remotion 的 Chromium，**耗时较长（5–15 分钟）属于正常**，不要中断。

> **网络慢或反复失败**：换成国内镜像后重试
> ```powershell
> npm config set registry https://registry.npmmirror.com
> npm install
> ```

**验收**
```powershell
npm test
```
此刻（轨道 B 尚未配置）正确的结果是：

```
ℹ tests 133
ℹ pass 130
ℹ fail 0
ℹ skipped 3
```

**判断标准只有一条：`fail 0`。**

- `skipped 3` 是**正常的** —— 那 3 个是即梦相关测试，还没装 Python 运行时
  所以自动跳过。做完轨道 B 后会变成 `pass 133 / skipped 0`。
- **总数可能和上面对不上**：随着功能增删，测试数量会变。
  **不要拿数字逐个核对**，只看 `fail` 是不是 0。

**如果出现 `fail 1` 或更多**，把完整输出（含失败的测试名和报错）反馈，不要自行修改代码绕过。

**排错**
- 报 `EPERM` / 权限错误 → 用管理员身份打开 PowerShell 重试
- 卡在 sharp / node-gyp → 先 `npm cache clean --force` 再 `npm install`

---

## 步骤 6 — 配置密钥

```powershell
copy .env.example .env
notepad .env
```

在打开的记事本里填入密钥。**至少填一个**才能生成，全空也能启动（只是不能生成）。

推荐先只填这两个，够跑通验证：

| 变量 | 用途 | 获取地址 |
|---|---|---|
| `ARK_API_KEY` | Seedance 2.0 视频（**推荐**，与即梦同模型） | 火山方舟控制台 |
| `GEMINI_API_KEY` | 图片生成、剧本分镜 | Google AI Studio |

其余（`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`）按需再填。

> **安全**：`.env` 已被 `.gitignore` 忽略，不会进版本控制。
> **绝不要**把密钥贴到聊天里、提交到 git、或写进任何 `.md` 文件。

---

## 步骤 7 — 启动并验证

```powershell
npm run dev
```

等待出现 `Backend server running on http://localhost:3001`，
浏览器打开 **http://localhost:5173**。

**验收（三项都要过）**

1. 页面能正常打开，左侧显示"画布暂无节点"
2. 另开一个 PowerShell 窗口执行：
   ```powershell
   curl http://localhost:3001/api/capabilities
   ```
   应返回 JSON，其中 `"platform":"win32"`、`"browserModels":{"ready":false...}`。
   **`ready:false` 在此阶段是正确的**（轨道 B 还没配）。
3. 在页面上点「新建节点」→「视频」，节点出现，模型下拉框里
   **Seedance 2.0 可选**，而"即梦""Google Flow"是**灰色且不可点**的。

✅ **三项都过 = 轨道 A 完成。** 此时项目已经可用。
如果不需要即梦/Flow，**到这里就可以停了**（但建议先做下面的步骤 7.5）。

---

## 步骤 7.5 — 配置双击启动（强烈建议）

上面用的 `npm run dev` 需要开着终端窗口，关掉窗口服务就没了。
项目里带了一个**双击即可启动**的入口，日常使用推荐用它。

### 位置

```
launcher-windows\Evan工作台.vbs     ← 日常用这个（图形界面，无黑框）
launcher-windows\Evan工作台.bat     ← 排错时才用（命令行，能看到报错）
```

### 发送到桌面

在文件资源管理器里找到 **`Evan工作台.vbs`** → **右键 → 显示更多选项 →
发送到 → 桌面快捷方式**。

以后双击桌面上那个快捷方式就行。

> ⚠️ **不要直接把文件本身复制到桌面** —— 它靠自己的位置来定位项目根目录，
> 挪走就找不到项目了。**必须用「快捷方式」**（快捷方式会指回原位置）。

### 双击后会看到什么

一个深色的小窗口（没有地址栏、没有黑框）：

```
┌────────────────────────────────────┐
│  🎬  Evan 工作台                    │
│      C:\...\AI-Video-Canvas        │
├────────────────────────────────────┤
│  前端画布      ● 运行中 · :5173     │
│  后端服务      ● 运行中 · :3001     │
├────────────────────────────────────┤
│       [    打开画布    ]            │
│  [ 重启服务 ]    [ 停止服务 ]       │
│  [ 项目文件夹 ]  [ 刷新日志 ]       │
├────────────────────────────────────┤
│  （实时日志区）                     │
└────────────────────────────────────┘
```

**日常用法：双击 → 点「打开画布」。** 服务没起会自动拉起，然后自动打开画布。

### 几个要点

- **全程没有 cmd 黑框**：`.vbs` 静默启动，后端也是隐藏窗口跑的。
- **服务在后台独立运行**：关掉这个面板不会停止服务。想停就点「停止服务」。
- **日志直接显示在面板下方**，不用再去翻文件。
  （文件仍在 `logs\dev-server.log`。）
- **首次使用前必须先 `npm install`**，否则 `.vbs` 会弹窗提示。

### 面板是怎么实现的

Node 在本机起一个小服务（端口 5199）渲染这个页面，再用 Chrome 的
`--app` 模式打开——所以它看起来像原生窗口，其实是个本地网页。
没装 Chrome 的话会退回默认浏览器打开，功能一样，只是多了地址栏。

### 命令行用法（可选）

菜单之外也支持直接传参，适合写进你自己的脚本：

```powershell
npm run launcher:gui        # 图形面板（.vbs 调的就是它）
npm run launcher            # 命令行菜单
npm run launcher start      # 启动
npm run launcher stop       # 停止
npm run launcher restart    # 重启
npm run launcher status     # 查看状态
npm run launcher open       # 打开画布（必要时先启动）
```

### 排错

| 现象 | 原因 / 处理 |
|---|---|
| 双击 `.vbs` 后毫无反应 | 它是静默运行的，报错看不见。**改双击 `Evan工作台.bat`**，那个会把报错显示出来 |
| 弹窗「找不到 package.json」 | 文件被复制到别处了。删掉，回项目里用「发送到 → 桌面快捷方式」 |
| 弹窗「还没有安装依赖」 | 先在项目目录跑一次 `npm install` |
| 面板打开了但状态一直「未运行」 | 点「打开画布」拉起服务；仍失败就看面板下方日志 |
| 点「打开画布」转圈 60 秒后失败 | 看面板下方日志，多半是端口被占或 `.env` 有语法错误 |
| 面板带着地址栏（像普通网页） | 没找到 Chrome，退回默认浏览器了。功能一样，装了 Chrome 就会变成无边框窗口 |

---

# 第二部分：轨道 B（可选，即梦 / Google Flow）

> **先确认账号**，否则配了也用不了：
> - 即梦 → 需要**自己的即梦 VIP 会员**
> - Google Flow → 需要**有 Flow 权限的 Google 账号**
>
> 登录态**无法随项目分发**，必须在这台电脑上用自己的账号登录一次。

## 步骤 8 — 安装 Python 3.11+

**方式一：winget**
```powershell
winget install --id Python.Python.3.12 -e
```

**方式二：手动下载**（没有 winget 时用）
1. 打开 https://www.python.org/downloads/windows/
2. 下载 **Python 3.12.x** 的 Windows installer (64-bit)
3. 双击安装，**第一屏务必勾选 “Add python.exe to PATH”**（漏勾会导致后面找不到 Python）

新开 PowerShell 窗口。

**验收**
```powershell
py -3.12 --version
```
应打印 `Python 3.12.x`。

> 安装脚本会按 `py -3.13` → `py -3.12` → `py -3.11` → `python` 的顺序探测，
> 只要有一个 ≥3.11 即可。

---

## 步骤 9 — 安装 Chrome Beta

轨道 B 需要一个浏览器来做页面自动化。

> ⚠️ **Chrome Beta 是需要单独安装的，Windows 不自带，装了普通 Chrome 也不会有它。**
> 它和你日常用的 Chrome 是两个独立的程序，可以共存，互不影响。

### 9.1 安装

**方式一：winget（优先试这个）**

```powershell
winget install --id Google.Chrome.Beta -e
```

如果提示**找不到这个包**，先搜一下确认准确的 ID：

```powershell
winget search "Chrome Beta"
```

然后用搜出来的 ID 重新装（形如 `winget install --id <搜到的ID> -e`）。

**方式二：手动下载（winget 不行就用这个）**

1. 打开 https://www.google.com/chrome/beta/
2. 下载安装包，双击安装，一路默认即可
3. **安装完不要打开它**，也不要设成默认浏览器

### 9.2 验收 —— 确认装到哪了

```powershell
Test-Path "C:\Program Files\Google\Chrome Beta\Application\chrome.exe"
```

返回 `True` 即通过，**可以进入下一步**。

返回 `False` 的话，它可能装到了用户目录下（Chrome 有时会这样），
用这条命令把真实路径找出来：

```powershell
Get-ChildItem -Path "$env:ProgramFiles","${env:ProgramFiles(x86)}","$env:LOCALAPPDATA" `
  -Filter chrome.exe -Recurse -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty FullName
```

把输出里**带 `Chrome Beta` 字样**的那一条记下来，下一小节要用。

### 9.3 配置 —— 只有装在非标准位置才需要做

代码会自动探测这三个位置，**装在其中任意一个就不用配置，跳过本节**：

- `%ProgramFiles%\Google\Chrome Beta\Application\chrome.exe`
- `%ProgramFiles(x86)%\Google\Chrome Beta\Application\chrome.exe`
- `%LOCALAPPDATA%\Google\Chrome Beta\Application\chrome.exe`

只有当 9.2 找出来的路径**不在上面三个之列**时，才需要手动指定。
编辑项目根目录的 `.env`，加一行：

```
SESSIONHUB_CHROME_APP=C:\你在9.2找到的实际路径\chrome.exe
```

> 注意：**路径不要加引号**，即使里面有空格也不要加。
> 这是 `.env` 文件的写法，和 PowerShell 命令行的规则不一样。

配完这一步还**无法立刻验证**（需要先装 Python 运行时）。
真正的确认在**步骤 11.0**，那里会打印出代码最终选中的浏览器路径。

### 为什么专门装 Beta，而不是用你日常的 Chrome

不是洁癖，是有实际后果的：

1. **Windows 上自动化窗口会一直显示在桌面上。** 「隐藏窗口」那个功能是
   macOS 专有的 API（AppleScript），Windows 上没有等价物，代码里是空操作。
2. 所以那个 9222 窗口会一直杵在你的任务栏里。**如果它长得和你日常的 Chrome
   一模一样，你极容易顺手把它关掉** —— 而一旦在生成过程中关掉，任务会直接
   中断并报 `BROWSER_CLOSED`，即梦那边可能已经扣了额度。
3. **Beta 的图标是不同颜色的，一眼就能分辨**，误关的概率大幅降低。

另外它的安装位置和配置目录都与日常 Chrome 完全独立，不会互相干扰。

### 代码怎么找浏览器（探测顺序）

1. `.env` 里的 `SESSIONHUB_CHROME_APP`（**优先级最高**，手动指定用这个）
2. **Chrome Beta**，依次探测：
   - `%ProgramFiles%\Google\Chrome Beta\Application\chrome.exe`
   - `%ProgramFiles(x86)%\Google\Chrome Beta\Application\chrome.exe`
   - `%LOCALAPPDATA%\Google\Chrome Beta\Application\chrome.exe`
3. **普通 Chrome**（Beta 没装时自动回退），同样探测上面三个位置的
   `Google\Chrome\Application\chrome.exe`

**所以不装 Beta 也能跑** —— 会自动回退到普通 Chrome，只是有上面说的误关风险。

**排错**：如果报「找不到 Chrome」，说明两个都没探测到。
找到 `chrome.exe` 的真实路径后，在 `.env` 里加一行（注意路径**不要**加引号）：
```
SESSIONHUB_CHROME_APP=C:\你的实际路径\chrome.exe
```

---

## 步骤 10 — 安装 Python 运行时

```powershell
npm run setup:browser-models
```

脚本会自动：建虚拟环境 → 装依赖（playwright、typer 等）→ 自检。

**验收**
看到 `✅ ops_cli 正常，image-to-video / text-to-image 均已就绪` 即通过。

手动复验：
```powershell
cd server\python
.venv\Scripts\python.exe -m ops_cli --help
cd ..\..
```
应列出 `image-to-video` 和 `text-to-image` 两个命令。

**排错**
- 提示找不到 Python → 回步骤 8，并确认**新开了** PowerShell 窗口
- pip 下载超时 → 配国内镜像：
  ```powershell
  server\python\.venv\Scripts\python.exe -m pip install -r server\python\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  ```

---

## 步骤 11 — 启动 9222 浏览器并登录 ⚠️ 关键步骤

**这一步必须用「有头」（能看见窗口的）浏览器，因为要手动输入账号密码。**

### 11.0 先确认代码找到的是哪个浏览器 ⚠️ 别跳过

这条命令会打印出代码**最终选中**的浏览器——步骤 9 的安装和配置到底生效没有，
看这里最准：

```powershell
cd server\python
.venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'sessionhub'); from scene import chrome_cdp as c; print('浏览器路径:', c.CHROME_BIN); print('文件存在:', c.CHROME_BIN.exists()); print('配置目录:', c.PROFILE_DIR)"
cd ..\..
```

**期望输出**（三条都要对）：

```
浏览器路径: C:\Program Files\Google\Chrome Beta\Application\chrome.exe
文件存在: True
配置目录: C:\Users\你的用户名\.sessionhub\chrome-9222
```

判读：

| 看到的情况 | 说明 | 怎么办 |
|---|---|---|
| 路径含 `Chrome Beta`、存在 True | ✅ 正常 | 继续下一步 |
| 路径是普通 `Chrome`、存在 True | Beta 没装成，回退了 | 能用，但有误关风险。想修就回步骤 9 |
| **存在 False** | **路径不对，现在跑必失败** | 回步骤 9.2 找真实路径，按 9.3 配 `SESSIONHUB_CHROME_APP` |

> **把这里打印出的「浏览器路径」记下来**，下面 11.1 启动命令要用它。

### 11.1 启动浏览器

先确保没有旧实例占用端口：
```powershell
netstat -ano | findstr :9222
```
有输出的话记下 PID，用 `taskkill /PID <PID> /T /F` 结束。

然后启动：
用 **11.0 打印出来的那条「浏览器路径」**启动（下面按装了 Beta 的默认位置写）：

```powershell
& "C:\Program Files\Google\Chrome Beta\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="$env:USERPROFILE\.sessionhub\chrome-9222" `
  --no-first-run --no-default-browser-check `
  about:blank
```

> 如果 11.0 打印的路径不是这个，**把第一行换成你实际的那条**。
> 这里的路径**要用引号包起来**（PowerShell 的规则，和 `.env` 里相反）。
>
> `--user-data-dir` 必须和 11.0 打印的「配置目录」**完全一致**，
> 否则你登录的是一个配置，自动化读的是另一个，会一直提示未登录。

会弹出一个**全新的、空白的浏览器窗口**（不是你日常那个）。在这个窗口里：

1. 打开 https://jimeng.jianying.com → 登录你的即梦账号（确认是 VIP）
2. 打开 https://labs.google/fx/tools/flow → 登录你的 Google 账号

**验收**
```powershell
curl http://localhost:9222/json/version
```
返回 JSON 且含 `"Browser": "Chrome/..."` 即通过。

### 关于无头（headless）—— 必读

代码的实际行为是这样的，理解清楚能少走弯路：

| 情况 | 行为 |
|---|---|
| 9222 **已经在跑**（你刚登录的那个） | **直接复用**，不重启、不切无头 |
| 9222 **没在跑**，由后端自动拉起 | **自动用无头模式**启动 |

两种模式**共用同一个用户数据目录**，所以登录状态是通用的——
你有头登录一次之后，后续无头运行也是已登录状态。

**但是**：
- **首次登录必须有头**，无头窗口你看不见也没法输密码
- 有头和无头**不能同时**用同一个数据目录，代码会先关掉再切换
- Windows 上"隐藏窗口"功能是**关闭的**（那是 macOS 专有的 API），
  所以你手动开的这个窗口会一直显示着 —— **这是正常的，别关它**

**建议：登录完就让这个窗口一直开着。** 这样最稳定，也避免了模式切换。

---

## 步骤 12 — 验证轨道 B

确认后端认到了运行时：
```powershell
curl http://localhost:3001/api/capabilities
```
`"browserModels":{"ready":true...}` 即通过。
（如果 `npm run dev` 在步骤 10 之前就启动了，**需要重启它**才能重新探测。）

先做**不消耗额度**的连通性测试：
```powershell
cd server\python
.venv\Scripts\python.exe -m ops_cli --json image-to-video jimeng generate --prompt "连通性测试" --duration 5 --aspect-ratio 16:9 --resolution 720P --output-dir "$env:TEMP\opstest" --dry-run
cd ..\..
```
返回的 JSON 里 `"success": true`、`"dry_run": true` 即通过。
**`--dry-run` 不会打开即梦、不会扣积分。**

最后做真实生成：在画布里新建视频节点 → 选「即梦 Seedance 2.0 VIP」→
输入提示词 → 点生成。这一步**会消耗 VIP 额度**。

---

# 常见问题

### 模型下拉里即梦/Flow 一直是灰的
后端没探测到 Python 运行时。依次检查：
1. `server\python\.venv\Scripts\python.exe` 存在吗？不存在 → 回步骤 10
2. `npm run dev` 是在步骤 10 **之后**启动的吗？不是 → 重启它
3. `curl http://localhost:3001/api/capabilities` 看 `ready` 的值

### 报错「未找到 Chrome」
`.env` 里加 `SESSIONHUB_CHROME_APP=` 指向 `chrome.exe` 的绝对路径（见步骤 9）。

### 报错 `BROWSER_CLOSED`
生成过程中 9222 浏览器被关了。任务**可能已经提交到即梦**——
先去即梦历史会话确认结果，避免重复生成扣积分。重试前保持窗口开着。

### 报错 `JIMENG_CONTENT_REJECTED`
**这不是程序错误**，是即梦的内容审核拒绝了你的素材。
常见原因：参考图含知名 IP 形象（如卡通角色）、真人肖像、敏感画面。
**换一张参考图**即可；只改提示词通常无效。

### 报错 `AUTH_REQUIRED` / 提示需要登录
9222 浏览器的登录态失效了。回步骤 11 重新登录。

### 端口被占用
```powershell
netstat -ano | findstr "3001 5173 9222"
taskkill /PID <PID> /T /F
```

### 中文显示成乱码
```powershell
chcp 65001
```

---

### `npm test` 出现 1 个 fail，提示 438 ≠ 384

**这个已经修复了**，如果你还遇到，说明代码不是最新的，先 `git pull origin main`。

原因：`438` 和 `384` 不是什么长度，是**八进制权限位的十进制值** ——
`0o600` = 384，`0o666` = 438。那条断言在检查密钥文件是否「仅属主可读写」，
而 **Windows 的 NTFS 没有 POSIX 权限位**，`chmod` 是空操作，
所以永远拿到 `0o666`，在 Windows 上**必然失败**。

现在该断言只在非 Windows 上执行。

> 顺带一提安全影响：Windows 上 `library\config\api-keys.json`（存放手动填的密钥）
> 无法靠 `chmod` 限制权限，实际权限由所在目录的 ACL 继承。
> 如果这台机器有多个用户账号，注意这一点。

---

# 出问题了怎么办

Windows 适配尚未在真机验证过，**遇到报错是预期内的**。请这样反馈：

1. **哪一步**（步骤编号）
2. **执行了什么命令**（原样复制）
3. **完整报错**（不要截断，尤其是 Python 的 Traceback）
4. 附上环境信息：
   ```powershell
   node --version; git --version
   py -3.12 --version
   curl http://localhost:3001/api/capabilities
   ```

Mac 那边修复推送后，你这样更新：
```powershell
git pull origin main
npm install
npm test
```
如果改动涉及 Python 侧，再跑一次 `npm run setup:browser-models`。

> **给 AI 助手的提醒**：如果某一步卡住，不要自行改动项目源代码去绕过——
> 那会让 Mac 那边的修复和你的本地改动冲突。**如实报告，等待修复推送。**
> 你可以自由排查环境问题（PATH、端口、权限），但**不要修改仓库里的代码文件**。
