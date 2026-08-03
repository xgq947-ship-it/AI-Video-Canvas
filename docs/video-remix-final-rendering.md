# Video Remix Timeline 与最终成片

最终成片层位于镜头视频人工确认之后。它复用现有 Project Manifest、Remotion
Composition、渲染任务、项目素材目录和 FFmpeg 母带链路，不新增 NLE，也不增加最终用户
运行前置条件。

## 进入条件与轻量 Timeline

只有全部 Shot 都已有校准后视频并完成确认时，成片页才会准备 Timeline。默认顺序严格
沿用原视频 Shot 顺序，生成视频的可用区间按相对时间 `0..targetDuration` 表示，避免把
原视频绝对时间误用于每个独立生成文件。

Timeline 只提供需求范围内的轻量编辑：

- Shot 上移、下移；
- 从当前项目视频素材中替换 Shot，并可恢复确认后的生成视频；
- 删除 Shot，且至少保留一个；
- 微调切入点和切出点；
- 选择 Hard Cut 或 Fade。

编辑后会重新编号、重算总时长、字幕时间和连续性报告。修改任一 Timeline、BGM 或字幕
选项都会使旧成片失效，但不会使已确认的镜头视频失效。

## BGM 与字幕

BGM 支持三种模式：

- 无：保留各 Shot 自带声音；
- 原视频音轨：关闭 Shot 声音，以原参考视频作为完整背景音轨；
- 上传音乐：通过现有项目音频上传接口保存素材，循环叠加在 Shot 声音之上，并允许调节
  音量。

自动字幕来自结构化分析中的 Dialogue Blueprint。字幕会依据当前 Timeline 顺序和切点
重新计算，不复用原视频中可能已经烧录的文字。用户可关闭字幕，或选择默认中文描边与
短视频大字两种样式。

## 连续性检查

成片页比较每个相邻切点的上一 Shot End State 与下一 Shot Start State，覆盖：

- 场景、场景功能区、光线与时间；
- 人物位置、朝向、情绪、手持道具和服装造型。

页面展示总体分数和逐项告警。该检查用于帮助人工判断，不会因为分析字段缺失或不一致
阻止用户渲染。

## Manifest 与 Remotion

`buildVideoRemixManifest()` 把当前 Timeline 映射到现有 Manifest：

- Shot 顺序、相对切点、音量和转场进入 `shots`；
- BGM 进入 `backgroundMusic`；
- 自动字幕及样式进入 `subtitles` 与 `output.subtitleStyle`；
- 输出文件名包含当前输入哈希，相同输入可稳定定位同一成片。

Manifest 仍先经过现有校验器，再提交现有 `/api/render/start`。Remotion Composition 支持
Hard Cut 与边界淡出 / 淡入，最终继续输出 H.264 视频和 AAC 音频，并走已有响度母带。
整个成片过程不会调用任何 AI Provider。

## 状态、恢复与可选画布输出

渲染任务把 `jobId`、`inputHash`、阶段、进度、日志和错误持久化到 Video Remix 状态。
轮询结果必须同时匹配任务 ID 与输入哈希，旧任务不能覆盖新的 Timeline。应用重启后：

- 仍存在的任务按当前渲染接口继续查询；
- 若内存任务已消失，则按稳定输出文件名扫描当前项目素材；
- 找到成片时恢复为完成状态，找不到时变为可安全重试的错误，不会自动重复渲染。

完成后成片首先保存在当前项目的复刻任务中，不会自动改变 AI 画布。用户点击“发送到
AI 画布”后才创建或更新一个普通 Final Video 节点；再次发送复用同一节点 ID，并保留
用户移动后的坐标和自定义名称。该节点不依赖已移除的复刻容器，内部 Shot 也不会展开成
多个画布节点。

## 本地验收

Phase 9 使用两个本地 640×360、带 AAC 声音的短视频完成浏览器与真实 Remotion 验收：

- Timeline 为 2 Shot、总目标时长 2.20 秒，首个切点使用 Fade；
- Dialogue Blueprint 生成两条随 Timeline 排时的短视频样式字幕；
- 连续性检查正确报告相邻 Shot 的道具变化；
- 渲染输出经内置 FFprobe 验证为 H.264 + AAC、640×360、2.261 秒；
- 刷新应用后仍恢复完成状态；执行“发送到 AI 画布”后，画布只保留一个普通 Final Video 节点；
- 验收项目与素材在检查后通过项目删除接口清理。

未登录 Gemini 不影响 Timeline 编辑、字幕排时、连续性检查、Manifest 构建、Remotion
渲染或成片恢复。
