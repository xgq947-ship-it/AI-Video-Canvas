# Video Remix MVP 验收说明

验收日期：2026-08-01

## 结论

Video Remix 第一版 MVP 已贯通以下阶段式工作流：

```text
参考视频 → 本地化 → 自动拆 Shot → 结构化分析 → 资产替换
→ Prompt → Shot 视频 → Timeline / BGM / 字幕 → Remotion 成片

可选增强：人物/场景/道具三图一致性包，以及起始 / 中间 / 结束关键帧。
```

当前入口是应用顶部的独立“短视频复刻”工作区，不再是画布节点。一个项目可保存多个复刻
任务；AI 画布与复刻任务共用项目目录、素材库和自动保存，但各自保持清晰的操作界面。

本地画布、导入、预处理、编辑、持久化、恢复和 Remotion 渲染不依赖 Gemini 登录。
Gemini 未登录时，只有真实视频理解请求，以及用户主动选择复用 Gemini 的现有自动字幕功能
不可用；已有项目和所有本地阶段仍可正常打开、编辑与导出已具备素材的成片。

## MVP 需求覆盖

| 需求 | 实现与验收 |
|---|---|
| 本地、画布视频、分享 URL | 支持 `.mp4`、`.mov`、`.webm`，画布视频“发送到短视频复刻”，分享文案 URL 提取、Media Resolver、本地化和重试 |
| 视频预处理 | 复用 FFprobe / FFmpeg 生成代理、检测场景、建立 Shot、提取五档参考帧；支持手调切点、拆分和合并 |
| Gemini 结构化分析 | 全片一次上传，Shot 按 simple / medium / complex 分级分析；严格结构校验、会话内纠错、置信度和可编辑锁定字段 |
| 人物、造型、场景、区域、道具 | 自动提取参考资产，支持素材库/角色库/上传替换、全局替换和单 Shot 造型覆盖 |
| Prompt 四层管线 | 保存 Raw、Resolved、Image Optimized、Video Optimized；资产、模型或手工 Prompt 改动按依赖范围失效缓存 |
| 资产最小门槛 | 有人物时任意一张真实人物主参考图即可继续；场景、道具和完整三图包可省略，无人物镜头支持纯提示词生成 |
| 关键帧 | 可选增强；simple / medium / complex 仍可规划 Start、Start + End 或 Start + Middle + End，支持批量并发、单帧重试和确认，但不再阻断视频生成 |
| Shot 视频 | 无首尾帧也可按文本或人物/产品资产参考生成；按模型能力选择文生视频、首尾帧或 Ingredients 协议，把动作、运镜、时序、对白、环境音与动作音效写入 Prompt；支持单 Shot 重试和确认门 |
| 时长与连续性 | 优先裁剪，必要时只做不低于 `0.85x` 的轻微补时；检查场景、光线、人物状态和持有道具连续性 |
| Timeline 与转场 | 恢复原 Shot 顺序和相对切点，支持排序、替换、删除、裁剪、`hard_cut` 和 `fade` |
| BGM | 支持无 BGM、使用原视频音轨、用户上传三种模式 |
| 字幕 | 从 Dialogue Blueprint 生成新字幕并复用 Remotion 字幕样式；现有 Final Video Node 的自动 ASR 能力仍可单独使用 |
| Remotion 输出 | 复用现有 Manifest / Renderer，支持渲染进度、取消、失败恢复；成片先保存在复刻任务中，用户明确点击后才创建或更新一个普通视频节点 |
| 持久化与恢复 | 多个复刻任务写入项目级 `videoRemixes[]`；旧画布容器节点自动迁移并做一次迁移前备份；平台提交未知时不盲目重投，安全的本地任务可恢复 |

## 验收案例

自动回归使用一条等价于 18 秒参考片的结构化 fixture：3 个 Shot、2 个人物、2 个场景、
1 个道具和 1 句对白。测试覆盖只准备人物主图便直接生成、无人物纯提示词生成，以及可选的
simple / medium / complex 关键帧计划与确认；随后完成全部 Shot 视频确认、Timeline、上传 BGM、字幕、Manifest、渲染状态，
最后断言成片保留在独立任务中，只有执行“发送到 AI 画布”后才出现一个普通 Final Video Node。

此外使用本地 2 Shot 媒体做了真实 Remotion 冒烟验收：输出为 640×360、H.264 + AAC、
时长 2.261 秒，两个 Shot 和两段字幕均可见；刷新项目后仍保持完成状态。独立工作区迁移
另验证了多任务保存、旧节点幂等迁移、迁移前备份、素材路径改写与回收站引用保护。

以上验证的是 Evan 的工作流、数据约束和本地渲染。故事、动作、人物与场景的真实生成
相似度属于上游模型输出质量，必须在用户登录 Gemini 和所选图片/视频 Provider 后，用
15～30 秒真实参考视频另行主观验收；未登录时不会自动调用或消耗这些服务。

## 第一版边界

以下属于需求文档明确允许暂缓的能力：高级动作骨骼分析、光流追踪、Pose Transfer、
Motion ControlNet、精确口型后处理、独立 TTS、独立 SFX、AI BGM、复杂 NLE、高级转场、
全自动一键模式和多版本 A/B Remix。

“展开镜头到画布”仍不属于第一版 MVP 清单。复刻流程保持为项目级任务，内部 Shot 不会
铺到画布；只有最终成片可由用户明确发送为普通视频节点。

## 最终验证结果

- 项目级任务、旧数据迁移、最终输出桥接和素材保护均有专项回归测试。
- 全仓回归：617 项全部通过。
- TypeScript：`tsc --noEmit` 通过。
- 生产构建：Vite 成功转换 2377 个模块并产出前端资源；仅保留项目既有的大 Chunk 提示。

## 回归入口

```bash
node --test test/videoRemix*.test.mjs
npm run typecheck
npm test
npm run build
```

核心实现说明见：

- [Media Resolver 与参考视频](video-remix-media-resolver.md)
- [拆镜头与预处理](video-remix-shot-pipeline.md)
- [Gemini 结构化分析](video-remix-gemini-analysis.md)
- [资产替换](video-remix-asset-system.md)
- [Prompt 管线](video-remix-prompt-pipeline.md)
- [关键帧工作流](video-remix-keyframes.md)
- [Shot 视频生成](video-remix-video-generation.md)
- [Timeline 与最终渲染](video-remix-final-rendering.md)
