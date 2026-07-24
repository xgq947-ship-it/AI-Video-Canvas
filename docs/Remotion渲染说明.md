# Remotion 渲染说明

最终成片由 [Remotion](https://www.remotion.dev/) 4.0.489 渲染。渲染引擎以**通用配置驱动**方式
接入，画布只负责生成 manifest、提交渲染、显示进度和预览结果 —— **不会把 Remotion Studio 嵌入画布**。

## 通用合成

- 入口：[`remotion/index.ts`](../remotion/index.ts) → [`remotion/Root.tsx`](../remotion/Root.tsx)
- 合成组件：[`remotion/MangaComposition.tsx`](../remotion/MangaComposition.tsx)
- 合成 id：`Manga`
- 宽 / 高 / 帧率 / 时长全部由传入的 `manifest` 通过 `calculateMetadata` **动态计算**。

参考自已验证的《三分钟后的来电》工程（`04_练习项目/07_剪辑工程`），但已**移除全部单片硬编码**
（文件名、镜头数量、字幕内容、声音入点、项目标题、输出文件名），改为完全由 manifest 驱动。

复用的已验证能力：

- 1280×720 · 24fps · H.264 + AAC 48kHz
- `OffthreadVideo` + `objectFit: cover`（等比铺满不拉伸）
- 多镜头按 `order` 首尾**硬切**拼接
- 配音 / 环境声 / 音效 / 背景音乐分层音轨，支持淡入淡出、循环
- 对白期间 BGM **自动闪避(ducking)**
- 通用中文字幕（淡入淡出）
- 结尾**淡黑**
- ffmpeg `loudnorm` 响度母带
- ffprobe 成片验收

## 渲染管线（程序化）

服务端 [`server/services/remotionRender.js`](../server/services/remotionRender.js) 用
`@remotion/bundler` + `@remotion/renderer` 程序化渲染（重依赖在函数内动态 `import()`，
无渲染需求时不影响服务启动）：

1. **校验**：结构校验 + 素材存在性 + 路径穿越防护
2. **打包**：`bundle(remotion/index.ts, publicDir=library/)`（进程内缓存复用）
3. **合成**：`selectComposition('Manga', { manifest })` —— `calculateMetadata` 据此算出时长
4. **渲染**：`renderMedia({ codec:'h264', audioCodec:'aac', onProgress })` 输出到临时文件
5. **母带**：ffmpeg `loudnorm=I=-16:TP=-1.5:LRA=11` + AAC 192k/48k + `+faststart` → 最终成片

`onProgress` 提供 `preparing → bundling → composing → rendering → mastering → done` 各阶段进度。

## 渲染任务 API

任务管理在 [`server/services/renderJobs.js`](../server/services/renderJobs.js)（内存态、非阻塞、
同一项目默认只允许一个进行中的任务），路由在 [`server/routes/render.js`](../server/routes/render.js)：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/render/validate` | 仅校验清单与素材，不渲染 |
| POST | `/api/render/remotion` | 提交渲染，返回 `jobId` |
| GET | `/api/render/remotion/:jobId` | 查询状态 / 进度 / 日志 |
| POST | `/api/render/remotion/:jobId/cancel` | 取消 |
| GET | `/api/render/remotion/:jobId/output` | 下载 / 预览成片 |
| POST | `/api/render/remotion/:jobId/reveal` | 在 Finder / 文件管理器中显示成片 |

- 用**参数数组**调用子进程（ffmpeg / open），绝不拼接未经校验的 shell 字符串。
- 状态：`queued → rendering → success | failed | cancelled`。
- 成功后成片保存到 `library/renders/`（已被 `.gitignore` 忽略）。

## 本地验收（不调用付费 API）

```bash
# 用 ffmpeg 生成测试素材（2 视频 + 对白 + 音效 + BGM），再端到端渲染
npm run render:e2e-test
# 输出：library/renders/manga-e2e-test.mp4

# 使用项目内置 ffprobe 验收
node_modules/ffmpeg-ffprobe-static/ffprobe -v error \
  -show_entries stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate \
  -show_entries format=duration -of default=noprint_wrappers=1 library/renders/manga-e2e-test.mp4
```

预期：`h264` / `1280x720` / `24/1` fps / `aac` / `48000` Hz。

## 首次渲染

源码开发先执行 `npm run setup:browser-models`；Remotion 会复用 Evan 内置 Chromium。
FFmpeg 与 FFprobe 由项目依赖提供，不需要系统安装。
