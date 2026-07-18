<div align="center">
  <img src="public/TwitCanva-logo.png" alt="Evan Logo" width="120" />
  <h1>Evan</h1>
</div>

A modern, AI-powered canvas application for generating and manipulating images and videos using OpenAI GPT Image, Google Gemini, Kling AI, Hailuo AI (MiniMax), and Fal.ai. Built with React, TypeScript, and Vite.

---

## 🎬 AI 漫剧 0—1 生产工作台（中文）

在 Evan 无限画布的基础上，本项目增量扩展为**「AI 漫剧 0—1 生产工作台」**：
在同一个本地画布里，从一句故事一路做到一条可播放的 MP4 成片。

### 这是什么

```
输入故事 → AI 生成剧本 → AI 拆解分镜 → 生成角色与场景图 → 生成镜头关键帧
→ 图片生成视频 → 生成角色配音 → 添加字幕 → 添加音乐/环境音/音效
→ 配置镜头顺序和时长 → Remotion 自动渲染 → 输出最终 MP4 成片
```

- 生图 / 生视频 / 配音调用线上官方 API；本地只运行画布、素材库、项目管理与 **Remotion 渲染**。
- 保留 Evan 原有画布、故事板、素材库和图片/视频生成功能。
- 角色素材支持“4 张身份库 + 多套服装造型包”，按角色名称和造型名称筛选；造型素材连接下游生图节点时自动携带身份与同造型参考图。
- 最终渲染引擎为 [Remotion](https://www.remotion.dev/) 4.0.489，**完全由 project-manifest 驱动**，无单片硬编码。

### 安装

```bash
npm install           # 安装依赖（含 Remotion 渲染引擎）
cp .env.example .env  # 配置密钥（可留空，见下）
```

需系统已安装 `ffmpeg` 与 `ffprobe`（响度母带与成片验收用）。

### 配置 .env

见 [`.env.example`](.env.example)。所有密钥**只在服务端读取**，不进入前端/工作流 JSON/Git。
**没有任何密钥时，应用仍可启动、编辑画布、导入本地素材、并用本地素材完成 Remotion 渲染。**

| 功能 | 需要的密钥 |
|---|---|
| 图片生成 | `GEMINI_API_KEY` / `OPENAI_API_KEY` |
| 视频生成 | `HAILUO_API_KEY` / `KLING_ACCESS_KEY`+`KLING_SECRET_KEY` / `FAL_API_KEY` |
| Google Flow 工作流视频 | 无需 API Key；需要本机 9222 Chrome 已登录 Google Flow |
| 剧本 / 分镜 | `GEMINI_API_KEY` |
| 配音 (TTS) | MiniMax 画布直连需要 `MINIMAX_API_KEY` + `MINIMAX_GROUP_ID`（可回退 `HAILUO_API_KEY`）；ChatCut/ElevenLabs、豆包、Fish、本地 Qwen 与其他平台可生成后导入 |
| 画布 / 导入本地素材 / Remotion 渲染 / ffmpeg 母带 | **完全本地，无需密钥** |

> **API 费用由谁产生**：生图/生视频/配音调用线上 API，费用由对应密钥所属账号承担。
> 画布编辑、导入本地素材、Remotion 渲染与 ffmpeg 母带完全本地、不产生费用。
> 测试与本地验收（`npm run render:e2e-test`）只用 ffmpeg 生成的素材，**不调用任何付费 API**。

### 启动

```bash
npm run dev     # 同时启动后端(:3001) 与前端(:5173)
```

浏览器打开 http://localhost:5173 。

### 如何创建完整视频工作流

双击画布空白处（或点左侧 `+`）添加节点。「AI 漫剧 · 声音与成片」组新增：
**配音(TTS) / 音效 / 背景音乐 / 字幕 / Remotion 成片** 五个节点。

把 视频镜头 / 配音 / 音效 / 背景音乐 / 字幕 节点都连接到「Remotion 成片」节点，
在成片节点上点「开始渲染成片」即可。完整分步教程见
[docs/AI漫剧0-1工作流.md](docs/AI漫剧0-1工作流.md)。

- 每个节点的用途、连接规则、生成配音、配置字幕与声音：[docs/AI漫剧0-1工作流.md](docs/AI漫剧0-1工作流.md)
- 渲染管线、渲染任务 API、本地验收：[docs/Remotion渲染说明.md](docs/Remotion渲染说明.md)
- 统一 manifest 数据格式与路径安全：[docs/项目数据格式.md](docs/项目数据格式.md)

### 成片保存位置

成功渲染的 MP4 保存在 **`library/renders/`**（已被 `.gitignore` 忽略）。成片节点可内嵌预览、
下载、在 Finder 中显示、重新渲染。

### 本地验收 / 测试（不产生 API 费用）

```bash
npm run build            # 生产构建必须通过
npm test                 # 单元测试：manifest 转换 / 路径校验 / 渲染任务逻辑
npm run render:e2e-test  # 用 ffmpeg 生成测试素材并端到端渲染出 MP4
```

### 常见错误

见 [docs/AI漫剧0-1工作流.md](docs/AI漫剧0-1工作流.md#八常见错误)。首次渲染会自动下载一次
Chrome Headless Shell（约 90MB）。

> **Seedance**：通过火山方舟中国区官方 API
> `https://ark.cn-beijing.volces.com/api/v3` 接入，设置中须填写同一火山方舟账号生成的中国区 API Key，
> 并在方舟控制台开通对应 Seedance 模型。项目不使用任何逆向破解的即梦接口。

---


![Evan](https://img.shields.io/badge/React-18.3.1-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6.2-blue)
![Vite](https://img.shields.io/badge/Vite-6.4.1-purple)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=SankaiAI/TwitCanva-Video-Workflow&type=date&legend=top-left)](https://www.star-history.com/?repos=SankaiAI%2FTwitCanva-Video-Workflow&type=date&legend=top-left)


## ✨ Features

- **🎨 Visual Canvas Interface** - Drag-and-drop node-based workflow
- **🤖 Multi-Model AI Generation** - GPT Image 1.5, Gemini Pro, Kling V1-V2.5 for images
- **🎬 Multi-Model Video Generation** - Veo 3.1, Google Flow workflow, Seedance, Kling, Hailuo
- **🎥 Camera Angle Control** - Transform any image by adjusting camera rotation and tilt angles (Qwen-Image-Edit)
- **📋 Storyboard** - Create video storyboards with consistent characters and layouts
- **💃 Motion Control** - Transfer motion from reference videos to character images (Kling V2.6 via Fal.ai)
- **📥 TikTok Import** - Download TikTok videos without watermark for use as motion references
- **🖼️ Image-to-Image** - Use reference images for generation
- **📽️ Frame-to-Frame Video** - Animate between start and end frames
- **🔗 Smart Node Connections** - Type-aware validation (IMAGE→VIDEO, TEXT→IMAGE, etc.)
- **💬 AI Chat Assistant** - Built-in chat with LangGraph agent
- **📚 Asset Library** - Save and reuse generated assets
- **💾 Workflow Management** - Save, load, and share workflows
- **⚡ Real-time Updates** - Hot module replacement for instant feedback
- **🎯 Aspect Ratio Control** - Multiple preset ratios for images
- **📹 Resolution Options** - 720p and 1080p for videos
- **🔒 Secure API** - Backend proxy keeps API keys safe
- **🔄 Auto-Model Selection** - Filters models based on input compatibility
- **🖥️ Local Open-Source Models** - Run Stable Diffusion, ControlNet, Qwen on your GPU
- **⚖️ Commercial Friendly** - Dual-licensed or permissive terms for commercial growth


## 🎥 Showcase

### App Overview
https://github.com/user-attachments/assets/7a64d4df-7ade-4bfa-b2cd-d615d267dd40

### Motion Control Example (Kling V2.6)
Transfer motion from a reference video to a character image - make anyone dance!

https://github.com/user-attachments/assets/1ee6cbf3-00a5-496e-852c-3304c6ebc6c9

### Output Example
Download all the generated videos and use video editting tool like CapCut to create a final video. Check result below.

https://github.com/user-attachments/assets/43cf8bb8-bf85-45f9-96da-657033126d94

https://github.com/user-attachments/assets/e6f89da5-d3a6-4889-a38b-672cf37bbd79

### Camera Angle Control
Transform any image by adjusting camera rotation and tilt angles.

https://github.com/user-attachments/assets/f0d678df-31ac-4431-bd7c-eea3950bfb1d

### Storyboard
Create video storyboards with consistent characters and layouts.

https://github.com/user-attachments/assets/3c36de54-d37e-4875-8403-5b6e4a6216e0


## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Google Gemini API key (get one at [Google AI Studio](https://aistudio.google.com/app/apikey))
- Kling AI API keys (get them at [Kling AI Developer](https://app.klingai.com/global/dev/api-key))
  - Requires purchasing API packages at [Kling AI Pricing](https://klingai.com/global/dev/pricing)
- Hailuo AI API key (get one at [MiniMax Platform](https://platform.minimax.io/user-center/basic-information/interface-key))
- OpenAI API key (get one at [OpenAI Platform](https://platform.openai.com/api-keys))
  - Requires [organization verification](https://platform.openai.com/settings/organization/general) to use GPT Image models
- Fal.ai API key (get one at [Fal.ai Dashboard](https://fal.ai/dashboard/keys)) - Required for Kling V2.6 Motion Control

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SankaiAI/TwitCanva.git
   cd TwitCanva
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Get from https://aistudio.google.com/app/apikey
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Get from https://app.klingai.com/global/dev/api-key
   KLING_ACCESS_KEY=your_kling_access_key_here
   KLING_SECRET_KEY=your_kling_secret_key_here
   
   # Get from https://platform.minimax.io/user-center/basic-information/interface-key
   HAILUO_API_KEY=your_hailuo_api_key_here
   
   # Get from https://platform.openai.com/api-keys
   OPENAI_API_KEY=your_openai_api_key_here
   
   # Get from https://fal.ai/dashboard/keys (for Kling V2.6 Motion Control)
   FAL_API_KEY=your_fal_api_key_here
   ```
   
   > ⚠️ **Security**: API keys are stored server-side only and never exposed to the client.

4. **Start the development server**
   ```bash
   npm run dev
   ```
   
   This starts both:
   - **Frontend dev server**: `http://localhost:5173`
   - **Backend API server**: `http://localhost:3001`

### Alternative: Docker Installation

If you prefer using Docker to run the application in a containerized environment (recommended for deployment):

1. **Clone the repository and set up .env** (same as steps 1-3 above)

2. **Run with Docker Compose**
   ```bash
   docker compose up -d --build
   ```

   - The app will run on `http://localhost:3001`
   - Data persists in the local `library/` folder
   - To stop: `docker compose down`

### Optional: Local Open-Source Models Setup

Evan supports running open-source AI models (like Stable Diffusion, Qwen Camera Control, ControlNet) locally on your GPU. This is **optional** - the cloud-based AI models work without this setup.

**Requirements:**
- NVIDIA GPU with 8GB+ VRAM (12GB+ recommended for larger models)
- Python 3.10+
- CUDA-compatible drivers

**Setup:**
```bash
# Option 1: Use npm script (recommended)
npm run setup:local-models

# Option 2: Run setup script directly
# Windows:
setup-local-models.bat

# Linux/macOS:
chmod +x setup-local-models.sh
./setup-local-models.sh
```

This will:
1. Create a Python virtual environment (`venv/`)
2. Install PyTorch with CUDA support (~2.8GB download)
3. Create the `models/` directory structure
4. Test GPU detection

**Adding Models:**

Download models from [HuggingFace](https://huggingface.co/models), [Civitai](https://civitai.com), or similar sites (`.safetensors`, `.ckpt`, or `.pt` files) and place them in the appropriate folder:

| Folder | Model Types | Examples |
|--------|-------------|----------|
| `models/checkpoints/` | Main image generation models | Stable Diffusion 1.5, SDXL, DreamShaper, Juggernaut XL, Flux |
| `models/loras/` | LoRA adapters for styles/characters | Art styles, character LoRAs, detail enhancers |
| `models/controlnet/` | Guided generation models | OpenPose, Canny, Depth, Tile |
| `models/video/` | Video generation models | AnimateDiff, Stable Video Diffusion (SVD) |

**Using Local Models:**
1. Right-click on canvas → Add Nodes
2. Select "Local Image Model" or "Local Video Model"
3. Choose your downloaded model from the dropdown
4. Enter a prompt and generate!

> 📖 For detailed documentation, see [docs/local-model-support.md](docs/local-model-support.md)

### Optional: Camera Angle Control Setup

Transform your generated images with AI-powered camera angle manipulation using the Qwen Image Edit model.

#### Option 1: Cloud Deployment (Recommended)
For users without high-end GPUs, we provide a Modal-based cloud deployment.

1. **Install Modal**:
   ```bash
   pip install modal
   modal setup
   ```

2. **Deploy the App**:
   ```bash
   modal deploy modal/camera_angle.py
   ```

3. **Configure Environment**:
   Copy the generated `generate` endpoint URL and add it to your `.env` file:
   ```env
   VITE_MODAL_CAMERA_ENDPOINT=https://your-workspace--camera-angle-control-cameraangle-generate.modal.run
   ```

4. **Managing Costs**:
   - **Auto scale-down**: Containers automatically shut down after 5 minutes of inactivity (no charges when idle).
   - **Stop the app completely**: Run `modal app stop camera-angle-control` to disable the endpoint entirely.
   - **Restart after stopping**: Run `modal deploy modal/camera_angle.py` again to re-enable.
   
   > **Tip**: Stop the app when not actively using the feature to avoid any accidental charges.

> 📖 For detailed documentation, see [docs/modal-camera-integration.md](docs/modal-camera-integration.md)


## 💾 Asset Storage

All generated assets are automatically saved to local folders. **These folders are created automatically** when the server starts if they don't exist.

### Storage Locations

| Asset Type | Folder | File Format | Notes |
|------------|--------|-------------|-------|
| **Images** | `library/images/` | `.png` + `.json` | Auto-saved on generation |
| **Videos** | `library/videos/` | `.mp4` + `.json` | Auto-saved on generation |
| **Workflows** | `library/workflows/` | `.json` | Manual save via UI |
| **Chat Sessions** | `library/chats/` | `.json` | Auto-saved per message |
| **Assets** | `library/assets/` | Various | User uploaded files |

### How It Works

1. **On server startup**: Directories are created with `fs.mkdirSync(dir, { recursive: true })`
2. **On generation**: Files are saved to disk and served via `/library/*` URLs
3. **Metadata**: Each asset has a `.json` file with prompt, timestamp, and other info
4. **Persistence**: Assets persist across server restarts


> **Note**: The `library/` folder is in `.gitignore` and won't be committed to the repository.

## 🎮 Usage

### Creating Nodes

1. **Double-click** on the canvas to open the context menu
2. Select **"Add Nodes"** → Choose node type (Image/Video)
3. Enter a prompt describing what you want to generate
4. Click the **✨ Generate** button

### Connecting Nodes

1. **Hover** over a node to reveal connector buttons (+ icons)
2. **Click and drag** from a connector to create a connection
3. **Release** on another node to connect and chain generation

### AI Chat

1. Click the **Chat** button in the top bar
2. Type your message or attach images from the canvas
3. The AI assistant can help with prompts, ideas, and more

### Saving Workflows

1. Click the **Workflows** button in the top bar
2. Enter a workflow name and click **Save**
3. Load saved workflows anytime from the same panel

### Canvas Navigation

- **Pan**: Click and drag on empty canvas space
- **Zoom**: `Ctrl/Cmd + Mouse Wheel` or use the zoom slider
- **Select**: Click on a node to select it
- **Multi-select**: `Shift + Click` or drag a selection box
- **Context Menu**: Right-click for additional options

### Tools

Access import tools via the **Wrench** icon in the left toolbar.

#### TikTok Video Import

Download TikTok videos without watermark to use as **motion references** for the Motion Control feature:

1. Click the **Wrench (Tools)** icon in the left toolbar
2. Select **Import TikTok** from the dropdown menu
3. Paste a TikTok video URL (tiktok.com, vm.tiktok.com, or vt.tiktok.com)
4. Click **Import Video** to download
5. Preview the video and click **Add to Canvas**

> **Tip**: The imported video will appear in your Video History and can be used as a motion reference when generating videos with Kling V2.6 Motion Control. This allows you to transfer dance moves, gestures, or any motion from TikTok videos to your AI-generated characters!

> **Note**: First and last frames are automatically trimmed to remove TikTok watermarks (requires ffmpeg installed on your system).

## 🔧 Available Scripts

```bash
npm run dev        # Start frontend + backend together
npm run server     # Start backend server only (port 3001)
npm run build      # Build for production
npm run preview    # Preview production build
```

## 🔒 Security

Your API key is **never exposed** to the browser:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Browser/Client │────▶│  Backend :3001  │────▶│  Gemini API │
│  (No API key)   │     │  (.env file)    │     │             │
└─────────────────┘     └─────────────────┘     └─────────────┘
```

- ✅ API key stored in `.env` (server-side only)
- ✅ `.env` file is in `.gitignore`
- ✅ Backend proxies all API calls
- ✅ No sensitive data in client code

## 📦 Tech Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons

### Backend
- **Express** - Web server
- **LangGraph.js** - Chat agent framework
- **@google/genai** - Gemini API client
- **dotenv** - Environment variables

### AI Models

**Image Generation:**
| Model | Provider | Image-to-Image | Multi-Image |
|-------|----------|:-------------:|:-----------:|
| GPT Image 1.5 | OpenAI | ✅ | ✅ |
| Gemini Pro | Google | ✅ | ✅ |
| Kling V1 | Kling AI | ✅ | ❌ |
| Kling V1.5 | Kling AI | ✅ | ❌ |
| Kling V2 New | Kling AI | ❌ | ❌ |
| Kling V2.1 | Kling AI | ❌ | ✅ |

**Video Generation:**
| Model | Provider | Text-to-Video | Image-to-Video | Frame-to-Frame |
|-------|----------|:-------------:|:--------------:|:--------------:|
| Veo 3.1 | Google | ✅ | ✅ | ✅ |
| Google Flow · Omni Flash | 本地 workflow / 9222 Chrome | ❌ | ✅ | ❌ |
| Kling V1 | Kling AI | ✅ | ✅ | ❌ |
| Kling V1.5 | Kling AI | ✅ | ✅ | ❌ |
| Kling V1.6 | Kling AI | ✅ | ✅ | ✅ |
| Kling V2 Master | Kling AI | ✅ | ✅ | ❌ |
| Kling V2.1 | Kling AI | ✅ | ✅ | ❌ |
| Kling V2.1 Master | Kling AI | ✅ | ✅ | ❌ |
| Kling V2.5 Turbo | Kling AI | ✅ | ✅ | ❌ |
| Hailuo 2.3 | MiniMax | ✅ | ✅ | ✅ |
| Hailuo 2.3 Fast | MiniMax | ❌ | ✅ | ❌ |
| Hailuo 02 | MiniMax | ✅ | ✅ | ✅ |
| Hailuo O2 | MiniMax | ✅ | ✅ | ❌ |
| Kling V2.6 Motion | Fal.ai | ❌ | ✅ | Motion Control |

**Chat:**
- **Gemini 2.0 Flash** - Chat conversations

## 🛠️ Development

### Code Style

See `code-style-guide.md` for detailed guidelines:

- **File Size Limits**: Components 300 lines, Utils 200 lines
- **TypeScript**: Strict typing, avoid `any`
- **Comments**: JSDoc for functions, section headers for organization

### Adding New Features

1. Add UI components in `src/components/`
2. Create custom hooks in `src/hooks/`
3. Add API routes in `server/index.js`
4. Update types in `src/types.ts`

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Follow the code style guide
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📝 License

This project is licensed under the Apache License 2.0.

### Commercial Usage
If you are using this project for commercial purposes or building a commercial product, please refer to the [NOTICE](file:///d:/AI_Agent_Practice/TwitCanva/NOTICE) file for notification requirements.


## 🙏 Acknowledgments

- OpenAI for GPT Image generation
- Google Gemini API for AI generation
- Kling AI for video generation
- MiniMax for Hailuo AI video generation
- Fal.ai for Kling V2.6 Motion Control API
- LangGraph for agent framework
- React team for the amazing framework
- Vite team for the blazing-fast build tool

---

**Built with ❤️ using React, TypeScript, and AI APIs from OpenAI, Google, Kling, MiniMax, and Fal.ai (2025)**
