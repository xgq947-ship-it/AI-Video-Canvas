# macOS 首次配置指南

> **这份文档是写给 AI 助手执行的。** 如果你是 AI，请从上往下逐步执行，
> **每一步都要跑「验收」命令确认通过再进入下一步**，不要跳步、不要合并步骤。
> 遇到验收不通过，先看该步的「排错」小节；仍解决不了就停下来，把命令、
> 完整报错、以及你所在的步骤编号告诉用户，不要自己发明替代方案。

**目标**：在一台全新的 Mac 上，把这个项目从零跑起来。

Windows 版见 [`windows-setup.md`](windows-setup.md)。

---

## 术语：两条轨道

| | 轨道 A | 轨道 B |
|---|---|---|
| 模型 | Gemini、OpenAI、Kling、Hailuo、**Seedance 2.0 (ARK)** | 即梦 Seedance VIP、Google Flow |
| 原理 | 调官方 HTTP API | 驱动一个**你手动登录过的 Chrome** |
| 需要 | 填 API 密钥 | Python + Playwright + Chrome + **自己的会员账号** |
| 难度 | 简单 | 复杂，问题多发 |

**必须先把轨道 A 跑通，再做轨道 B。**

如果只需要「能出片」，**轨道 A 就够了**：`Seedance 2.0 (ARK)` 和
`即梦 Seedance 2.0` 是同一个模型，只是前者按量付费、后者吃 VIP 会员额度。

---

## 步骤 0 — 确认机器信息

```bash
sw_vers
uname -m
```

- `ProductVersion` 建议 **13 (Ventura) 或更高**
- `uname -m` 输出 `arm64` = Apple 芯片，`x86_64` = Intel 芯片
  （下面 Homebrew 的安装位置不同，注意区分）

---

# 第一部分：轨道 A（必做）

## 步骤 1 — 安装 Xcode 命令行工具

npm 装原生依赖（sharp 等）时需要编译器。

```bash
xcode-select --install
```

会弹出图形化安装窗口，点「安装」，等它装完（几分钟）。**如果提示"已安装"就跳过。**

**验收**
```bash
xcode-select -p
git --version
```
第一条能打印路径、第二条能打印版本即通过（git 随命令行工具一起装上）。

---

## 步骤 2 — 安装 Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

装完注意看它最后输出的提示：**Apple 芯片需要手动把 brew 加进 PATH**：

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

（Intel 芯片装在 `/usr/local`，通常不用手动配。）

**验收**
```bash
brew --version
```

---

## 步骤 3 — 安装 Node.js（必须 22 或更高）

```bash
brew install node
```

**验收**
```bash
node --version
npm --version
```

**`node --version` 必须 ≥ v22.0.0。**

> **为什么卡这个版本**：`npm test` 用的是 `node --test test/*.test.mjs`，
> 依赖 Node 自身的通配符展开能力（Node 21 起支持）。低版本会出现
> "测试跑不起来"且看不出原因。

**排错**：如果之前用 nvm/n 装过旧版本，可能会盖掉 brew 的版本。
用 `which node` 看实际用的是哪个，必要时 `nvm install 22 && nvm use 22`。

---

## 步骤 4 — 安装 ffmpeg（渲染出片必需）

```bash
brew install ffmpeg
```

这个包比较大，装几分钟属正常。

**验收**
```bash
ffmpeg -version
ffprobe -version
```

---

## 步骤 5 — 拉取代码

```bash
cd ~/Documents
git clone https://github.com/xgq947-ship-it/AI-Video-Canvas.git
cd AI-Video-Canvas
```

> 这是**私有仓库**。如提示需要登录，让用户在浏览器完成 GitHub 授权，
> 或用 `gh auth login`。**不要把用户的密码或 token 写进任何文件或命令行里。**

**验收**
```bash
git log --oneline -1
ls
```
能看到最新 commit，且有 `package.json`、`server`、`src`。

> **给 AI 助手的重要提醒**：如果你把项目放在 `~/Desktop`、`~/Documents`
> 或 `~/Downloads` 下，macOS 的隐私保护（TCC）可能会让你**读不到这些目录**，
> 报 `Operation not permitted`。解决办法见文末「常见问题 → AI 助手无法读取项目文件」。

---

## 步骤 6 — 安装 Node 依赖

```bash
npm install
```

会下载 Remotion 的 Chromium，**耗时 5–15 分钟属于正常**，不要中断。

**验收**
```bash
npm test
```

此刻（轨道 B 尚未配置）正确的结果是：

```
ℹ tests 127
ℹ pass 124
ℹ fail 0
ℹ skipped 3
```

**关键：`fail 0`。** 那 3 个 skipped 是即梦相关测试，因为还没装 Python 运行时
而自动跳过 —— **这是正常的，不是失败**。（做完轨道 B 后会变成 `pass 127 / skipped 0`。）

---

## 步骤 7 — 配置密钥

```bash
cp .env.example .env
open -e .env
```

**至少填一个**才能生成，全空也能启动（只是不能生成）。

推荐先只填这两个，够跑通验证：

| 变量 | 用途 | 获取地址 |
|---|---|---|
| `ARK_API_KEY` | Seedance 2.0 视频（**推荐**，与即梦同模型） | 火山方舟控制台 |
| `GEMINI_API_KEY` | 图片生成、剧本分镜 | Google AI Studio |

其余（`OPENAI_API_KEY`、`KLING_API_KEY`、`HAILUO_API_KEY`、
`DEEPSEEK_API_KEY`、`MINIMAX_API_KEY`）按需再填。

> **安全**：`.env` 已被 `.gitignore` 忽略。
> **绝不要**把密钥贴到聊天里、提交到 git、或写进任何 `.md` 文件。

---

## 步骤 8 — 启动并验证

```bash
npm run dev
```

等待 `Backend server running on http://localhost:3001`，浏览器打开
**http://localhost:5173**。

**验收（三项都要过）**

1. 页面能打开，左侧显示"画布暂无节点"
2. 另开一个终端：
   ```bash
   curl http://localhost:3001/api/capabilities
   ```
   应返回 JSON，含 `"platform":"darwin"`、`"browserModels":{"ready":false...}`。
   **`ready:false` 在此阶段是正确的**。
3. 页面上点「新建节点」→「视频」，模型下拉里 **Seedance 2.0 可选**，
   而"即梦""Google Flow"是**灰色不可点**的。

✅ **三项都过 = 轨道 A 完成。** 不需要即梦/Flow 的话，**到这里就可以停了。**

---

## 步骤 8.5 — 启动管理器（可选）

`npm run dev` 需要一直开着终端。项目里带了一个管理器，支持后台运行：

```bash
npm run launcher
```

会出来一个菜单：启动 / 停止 / 重启 / 状态 / 日志 / 打开画布 / 打开项目文件夹。
**服务是脱离终端运行的**，启动后可以直接关掉窗口。

也支持直接传参：
```bash
npm run launcher start
npm run launcher stop
npm run launcher status
npm run launcher open
```

日志在 `logs/dev-server.log`。

> 这个管理器是跨平台的（Node 实现），Windows 那边还额外包了一层
> 双击启动的 `.bat`。
>
> macOS 另有一个功能更全的原生版本 `Evan工作台.app`（AppleScript +
> launchd 托管，支持开机自启），见 `launcher/启动管理说明.md`。
> 那个是 Mac 专属的，`npm run launcher` 则三平台通用。

---

# 第二部分：轨道 B（可选，即梦 / Google Flow）

> **先确认账号**，否则配了也用不了：
> - 即梦 → 需要**自己的即梦 VIP 会员**
> - Google Flow → 需要**有 Flow 权限的 Google 账号**
>
> 登录态**无法随项目分发**，必须在这台电脑上用自己的账号登录一次。

## 步骤 9 — 安装 Python 3.11+

```bash
brew install python@3.12
```

**验收**
```bash
python3.12 --version
```

> ⚠️ **不要用系统自带的 `python3`** —— macOS 自带的往往是 3.9，版本太低。
> 安装脚本会按 `python3.13` → `python3.12` → `python3.11` → `python3` 的顺序
> 探测，自动跳过版本过低的。

---

## 步骤 10 — 安装 Chrome ⚠️ macOS 与 Windows 不同

**macOS 默认用的是 Chrome Beta，不是普通 Chrome。**

原因：Beta 的 bundle id 独立（`com.google.Chrome.beta`），与你日常用的
Chrome 从系统层面隔离——这样双击 HTML 文件、点邮件里的链接时，
不会误投到自动化实例里去打断任务。

```bash
brew install --cask google-chrome@beta
```

**验收**
```bash
ls "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"
```
能列出文件即通过。

### 不想装 Beta？可以用普通 Chrome

macOS 上代码**只找 Beta 这一个路径**（不像 Windows 会自动探测多处），
所以如果你只想用普通 Chrome，**必须显式覆盖**。在 `.env` 里加：

```
SESSIONHUB_CHROME_APP=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
SESSIONHUB_CHROME_PROFILE=/Users/你的用户名/.sessionhub/chrome-9222
```

> 建议**连 `SESSIONHUB_CHROME_PROFILE` 一起改**，用一个独立目录。
> 否则自动化会和你日常的 Chrome 抢同一个配置目录，导致 Chrome 起不来
> 或把你的日常窗口卷进自动化。

---

## 步骤 11 — 安装 Python 运行时

```bash
npm run setup:browser-models
```

**验收**
看到 `✅ ops_cli 正常，image-to-video / text-to-image 均已就绪` 即通过。

手动复验：
```bash
cd server/python && .venv/bin/python -m ops_cli --help && cd ../..
```
应列出 `image-to-video` 和 `text-to-image` 两个命令。

**排错**
- 提示找不到 Python → 回步骤 9
- pip 下载超时 → 用国内镜像：
  ```bash
  server/python/.venv/bin/python -m pip install -r server/python/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  ```

---

## 步骤 12 — 启动 9222 浏览器并登录 ⚠️ 关键步骤

**这一步必须用「有头」（能看见窗口的）浏览器，因为要手动输入账号密码。**

### 12.0 先确认代码找到的是哪个浏览器 ⚠️ 别跳过

```bash
cd server/python
.venv/bin/python -c "import sys; sys.path.insert(0,'sessionhub'); from scene import chrome_cdp as c; print('浏览器路径:', c.CHROME_BIN); print('文件存在:', c.CHROME_BIN.exists()); print('配置目录:', c.PROFILE_DIR)"
cd ../..
```

**期望输出**：
```
浏览器路径: /Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta
文件存在: True
配置目录: /Users/你的用户名/.sessionhub/chrome-9222-beta
```

**`文件存在: False` 就不要继续**——现在跑必然失败。
回步骤 10 装 Chrome Beta，或用 `SESSIONHUB_CHROME_APP` 指向你实际的 Chrome。

> 与 Windows 不同：macOS 上代码**只找 Chrome Beta 一个路径**，不会回退到普通 Chrome。
>
> **把打印出的两条路径记下来**，下面启动命令要用。

### 12.1 启动浏览器

先确认端口没被占用：
```bash
lsof -iTCP:9222 -sTCP:LISTEN -P
```
有输出的话先关掉那个进程。

启动（Chrome Beta 版本）：
```bash
open -na "Google Chrome Beta" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.sessionhub/chrome-9222-beta" \
  --no-first-run --no-default-browser-check \
  about:blank
```

会弹出一个**全新的空白 Chrome Beta 窗口**。在这个窗口里：

1. 打开 https://jimeng.jianying.com → 登录即梦账号（确认是 VIP）
2. 打开 https://labs.google/fx/tools/flow → 登录 Google 账号

**验收**
```bash
curl http://localhost:9222/json/version
```
返回 JSON 且含 `"Browser": "Chrome/..."` 即通过。

### 关于无头（headless）—— 必读

代码的实际行为：

| 情况 | 行为 |
|---|---|
| 9222 **已经在跑**（你刚登录的那个） | **直接复用**，不重启、不切无头 |
| 9222 **没在跑**，由后端自动拉起 | **自动用无头模式**启动 |

两种模式**共用同一个用户数据目录**，所以登录状态通用——
有头登录一次之后，后续无头运行也是已登录状态。

**但是**：
- **首次登录必须有头**，无头窗口看不见也没法输密码
- 有头和无头**不能同时**用同一个数据目录，代码会先关掉再切换

**macOS 独有**：和 Windows 不同，Mac 上代码会用 AppleScript
**自动把这个窗口隐藏到后台**（避免自动化时窗口一直挡着你）。
所以窗口"消失了"是**正常行为**，不是崩溃——进程还在跑。

**建议：登录完就让它一直开着**（哪怕被隐藏），这样最稳定。

---

## 步骤 13 — 验证轨道 B

确认后端认到了运行时：
```bash
curl http://localhost:3001/api/capabilities
```
`"browserModels":{"ready":true...}` 即通过。
（如果 `npm run dev` 是在步骤 11 之前启动的，**需要重启它**才会重新探测。）

先做**不消耗额度**的连通性测试：
```bash
cd server/python
.venv/bin/python -m ops_cli --json image-to-video jimeng generate \
  --prompt "连通性测试" --duration 5 --aspect-ratio 16:9 --resolution 720P \
  --output-dir /tmp/opstest --dry-run
cd ../..
```
返回 `"success": true`、`"dry_run": true` 即通过。
**`--dry-run` 不会打开即梦、不会扣积分。**

最后在画布里新建视频节点 → 选「即梦 Seedance 2.0 VIP」→ 真实生成。
这一步**会消耗 VIP 额度**。

---

# 常见问题

### AI 助手无法读取项目文件（`Operation not permitted`）

macOS 的隐私保护（TCC）默认不让程序访问 **桌面 / 文稿 / 下载** 三个目录。
如果 AI 助手突然读不到项目文件，多半是这个。

判断方法：
```bash
ls ~/Desktop >/dev/null 2>&1 && echo "桌面可读" || echo "桌面被挡"
ls /tmp >/dev/null 2>&1 && echo "/tmp 可读" || echo "/tmp 被挡"
```
**桌面被挡但 /tmp 可读 = 确认是 TCC。**

解决：
1. 系统设置 → 隐私与安全性 → **文件与文件夹** → 找到你的 AI 客户端/终端
   → 打开对应目录的开关（或直接给「完全磁盘访问权限」）
2. **必须完全退出该 App 再重开**（⌘Q，不是关窗口）——
   TCC 权限变更**不会对已运行的进程生效**，这是最常见的坑

### 首次启动 Chrome Beta 弹「无法验证开发者」
系统设置 → 隐私与安全性 → 找到该提示 → 点「仍要打开」。

### 隐藏/切换窗口不起作用
AppleScript 控制窗口需要**辅助功能**权限：
系统设置 → 隐私与安全性 → 辅助功能 → 给终端（或 AI 客户端）打开。
不给也不影响生成，只是窗口不会自动隐藏。

### 模型下拉里即梦/Flow 一直是灰的
1. `server/python/.venv/bin/python` 存在吗？不存在 → 回步骤 11
2. `npm run dev` 是在步骤 11 **之后**启动的吗？不是 → 重启它
3. `curl http://localhost:3001/api/capabilities` 看 `ready`

### 报错「找不到 Chrome」
macOS 上默认只找 Chrome Beta。要么装 Beta（步骤 10），
要么在 `.env` 里用 `SESSIONHUB_CHROME_APP` 指向你实际的 Chrome。

### 报错 `BROWSER_CLOSED`
生成期间 9222 浏览器被关了。任务**可能已提交到即梦**——
先去即梦历史会话确认，避免重复生成扣积分。

### 报错 `JIMENG_CONTENT_REJECTED`
**这不是程序错误**，是即梦的内容审核拒绝了素材。
常见原因：参考图含知名 IP 形象（如卡通角色）、真人肖像、敏感画面。
**换一张参考图**即可；只改提示词通常无效。

### 端口被占用
```bash
lsof -iTCP:3001 -iTCP:5173 -iTCP:9222 -sTCP:LISTEN -P
kill -9 <PID>
```

---

# 更新代码

```bash
git pull origin main
npm install
npm test
```
如果改动涉及 Python 侧，再跑一次 `npm run setup:browser-models`。
