# Video Remix Prompt Pipeline

Video Remix 的 Prompt 层位于资产确认与关键帧生成之间。它复用现有
`/api/prompt/optimize` 路由及 Prompt Optimizer Provider，不新增模型后端，也不会在
构建或确认 Prompt 时自动调用图片、视频生成。

## 四层数据

每个 Shot 保存以下层：

1. `analysis`：结构化 Shot Blueprint，是剧情、构图、动作、运镜、节奏和声音的来源。
2. `rawPrompt`：由 Analysis 确定性生成的模板，资产使用 `{{ASSET_ID}}`。
3. `resolvedPrompt`：按当前人物、Look、场景 Zone、道具与目标视频模型在本地解析。
4. `optimizedPrompt`：由现有 Prompt Optimizer 优化模板后，再用当前资产解析的成品。

关键帧另有独立的 `rawImagePrompt`、`imagePromptTemplate` 与 `imagePrompt`。图片 Prompt
只描述静态时刻，不复用完整动作时间线。

## 稳定资产占位符

优化请求发送 Raw 模板。系统指令要求优化器原样保留全部 `{{ASSET_ID}}`；返回结果会
再次校验，缺失或新增占位符时拒绝保存并把该 Shot 标记为可重试。这样优化结果仍是可
解析模板，而不是绑定某一次资产选择的文本。

资产替换后：

- Raw 结构不变时，复用已优化模板；
- Resolved、Optimized Video Prompt 与 Optimized Image Prompt 在本地重新解析；
- 用户手写且已经展开资产描述的成品不会跨资产替换复用；
- 移除交互道具会删除视觉引用，但保留“空手且沿原运动路径”的正向动作约束；
- 资产和 Prompt 确认状态、关键帧、视频与成片会失效。

## 模型适配

- Google Flow：解析为自然语言资产描述，不保留 `@` 引用标签。
- 即梦 / Seedance：有参考图的资产解析为稳定 `@ASSET_ID` 标签。
- Gemini Web 与后续通用模型：使用隔离的 Video Remix 通用 Profile。
- 关键帧：统一使用 `image-remix-keyframe` 静态图片 Profile。

目标视频模型变化只使视频优化结果失效；输入和资产未变化时，关键帧优化结果可以继续
复用。

## 缓存与确认

每个 Shot 保存 Analysis、资产、视频优化输入、图片优化输入和最终 Prompt 的哈希。
Analysis 或 Raw 改动会清空对应优化结果；资产只变化时优先重解析；下游生成结果始终
失效，避免旧关键帧或旧视频混入新资产。

只有所有 Shot 同时具备用户确认或优化器生成的 Video Prompt 与 Image Prompt，且没有
未解析占位符时，才能确认 Prompt。优化失败只影响当前 Shot，支持单 Shot 重试和批量
继续。

未登录 Gemini 不影响本地 Raw/Resolved 构建、手动编辑和确认。只有选择需要网页登录的
分析或生成 Provider，并实际发起相应请求时，才需要完成该 Provider 的登录。
