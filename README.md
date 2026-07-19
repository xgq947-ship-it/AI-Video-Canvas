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
| 图片生成 | Google Flow 本地 workflow（无需 API Key）/ `GEMINI_API_KEY` / `OPENAI_API_KEY` / Kling 兼容图片模型：`KLING_ACCESS_KEY`+`KLING_SECRET_KEY` |
| 视频生成 | Seedance 2.0：`ARK_API_KEY` / Kling 3.0：`KLING_API_KEY` / Hailuo 2.3：`HAILUO_API_KEY` |
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

### 可用脚本

```bash
npm run dev        # 同时启动前端 + 后端
npm run server     # 仅启动后端（3001 端口）
npm run build      # 生产构建
npm run preview    # 预览生产构建
```

### 安全性

API Key 只保存在服务端 `.env`，浏览器端不会接触到任何密钥：

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  浏览器 / 前端    │────▶│   后端 :3001      │────▶│  各家生图/生视频/配音 API │
│  (不含任何密钥)   │     │  (读取 .env)      │     │                  │
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

`.env` 已加入 `.gitignore`，不会被提交进仓库。

### 技术栈

- 前端：React 18 + TypeScript + Vite + Tailwind CSS
- 后端：Express + LangGraph.js（AI 聊天助手）
- 渲染：Remotion 4.0.489

---

Copyright © 2025 SankaiAI. Licensed under the Apache License, Version 2.0.
本项目基于 SankaiAI 开源的 Evan（TwitCanva）二次开发。
