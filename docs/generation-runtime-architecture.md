# 三平台生成运行时架构

状态：已落地。适用范围：Google Flow、Gemini Web、即梦的网页 HTTP 生成链路。

## 结论

当前架构已经从“每个平台各自驱动网页”收敛为可长期复用的分层结构：画布与 API 路由只认
模型能力，Provider 只负责平台协议，统一运行时负责并发、状态、恢复边界和健康检查。
生成请求仍使用已经验证的 HTTP endpoint、请求体、签名和解析器，本次调度改造不改协议。

单个 Evan 后端进程内采用以下稳定策略：

- 同平台同账号的“准备 + 上传 + 提交”严格串行，并发数为 1。
- 不同平台可以并行，但同时处于提交临界区的平台最多 2 个。
- 平台返回提交响应后立即释放提交通道；长时间轮询和下载进入独立有界并发池。
- 任一生成任务未结束时，打开登录窗口、切换有头 Chrome、强制登录探针都会立即拒绝，
  避免导航或重启 Chrome 打断正在使用的会话。
- 已跨过提交边界的异常、取消和重启一律不自动重提，先按任务标识核对平台历史。

## 分层

```text
React 画布
  -> /api/generate-image | /api/generate-video
  -> workflow adapter（画布模型 id、参数归一化）
  -> Generation Runtime
       ├─ Provider Registry（运行策略）
       ├─ Scheduler（提交 / 轮询 / 下载并发）
       ├─ Job Journal（无凭证持久状态）
       └─ Health Aggregator（运行时、登录态、队列、历史状态）
  -> webhttp provider（Flow / Gemini / 即梦）
       ├─ protocol.js（纯请求构造与纯响应解析）
       ├─ provider.js（上传、提交、轮询、下载）
       └─ bridge.js（页面登录上下文中的 HTTP/XHR）
  -> Ops CLI 一次性进程
  -> 系统正式版 Chrome + Evan 专属 Profile
  -> 平台官方 HTTP 服务
```

主要代码边界：

- `shared/generationProviders.js`：前后端共用的模型能力基线。
- `server/services/webhttp/registry.js`：画布模型 id 与真实协议模型 id 的映射及动态发现。
- `server/services/generationRuntime/providerRegistry.js`：平台级并发和运行策略。
- `server/services/generationRuntime/scheduler.js`：任务级提交临界区与阶段并发。
- `server/services/generationRuntime/jobJournal.js`：任务提交边界和诊断状态。
- `server/services/generationRuntime/health.js`：统一健康快照。
- `server/services/webhttp/*/protocol.js`：不访问网络的协议函数。
- `server/services/webhttp/*/provider.js`：真实网络流程。

## 并发模型

一次任务分成三个阶段：

```text
queued -> waiting -> preparing -> submitting -> submitted
                                              ├-> polling
                                              └-> downloading -> completed
```

`preparing` 包括获取会话、创建工作区、上传参考图、刷新 reCAPTCHA 等提交前动作。
`submitting` 从首个计费请求即将发出开始，到桥接层确认拿到响应文件结束。整段由平台提交锁
保护，避免同账号多个任务互相污染 token、工作区或上传上下文。

调度上限：

| 阶段 | 同平台 | 全局 | 说明 |
|---|---:|---:|---|
| 准备与提交 | 1 | 2 | 同平台串行，不同平台最多两家并行 |
| 轮询 | 4 | 6 | 只查询已提交任务，不重复生成 |
| 下载 | 2 | 4 | 限制 CDN、内存与磁盘瞬时压力 |

三家的页面上下文请求还会经过各自的 bridge 队列，因此同一 Provider 的真实浏览器 HTTP
调用仍按顺序进入同一常驻标签页；Flow 的项目状态轮询、1K 原图下载和三家普通 CDN 下载
不占用 bridge 提交队列。Flow 2K 使用官方 `flow/upsampleImage` 页面鉴权请求，每张图需要
一个新的单次 reCAPTCHA token，因此同一批次按“取 token → 2K 请求”逐张串行。Chrome
冷启动或从可见登录实例切换到无头实例时，三平台先经过一个全局
启动闸门，只允许一个 CLI 执行 stop/start/connect；CDP 就绪后立即恢复跨平台并行。

每个平台的常驻页使用四重正向身份：URL Hash
`#evan-ai-video-canvas=<provider>`、`window.name`、`sessionStorage` 和持久化 CDP
`targetId`。每次调用只复用可响应且至少命中一项明确身份的页面；同域、同路径或
`about:blank` 都不能作为归属依据。发现重复时仅关闭带同一 Provider 明确身份的重复页，
所有未标记页和其他 Provider 页必须原样保留。页面选择/创建由 runtime 目录中的跨进程锁
保护，标签崩溃时只替换该明确标记页。冷启动直接把带 Hash 的平台地址交给 Chrome，不先
创建空白锚点；请求结束只断开 Playwright/CDP 连接，Chrome 与常驻页继续复用。

这些上限可以通过 `EVAN_WEB_GLOBAL_SUBMIT_CONCURRENCY`、
`EVAN_WEB_GLOBAL_POLL_CONCURRENCY`、`EVAN_WEB_GLOBAL_DOWNLOAD_CONCURRENCY` 调整。
正式桌面版推荐保留默认值。平台级上限由 Provider Registry 管理，不应散落在业务节点。

## 状态、失败和恢复边界

运行日志位于 `runtime/generation-jobs.json`，桌面版实际位置在 Evan 用户数据目录中。
日志只保存 provider、任务类型、模型 id、阶段和平台任务标识，不保存 Cookie、Bearer、签名、
提示词或图片内容；写入使用临时文件加原子重命名，最多保留 200 条终态记录。

关键终态：

- `completed`：结果已下载并交给路由保存。
- `auth_required`：提交前登录失效，可以登录后安全恢复内存中的待办任务。
- `interrupted`：应用退出时尚未提交，可以由用户安全重跑。
- `recovery_required`：已提交后轮询、下载、取消或重启中断，必须先查平台历史。
- `submission_unknown`：提交传输中断，不能确认平台是否接单，禁止自动重提。
- `failed` / `cancelled`：明确失败，或在提交前取消。

当前日志提供可靠诊断和重复扣费保护，但不保存完整输入，因此应用重启后不会自动重建并重提
任务。即梦可凭本地生成的 `submitId` 精确回捞；Flow 使用 `batchId/projectId/mediaId`，Gemini
使用 `conversationId` 辅助人工或后续恢复器查询。

## 健康检查

- `GET /api/settings/provider-health`：只读本地状态，不启动 Chrome、不访问平台。
- `GET /api/settings/provider-health?probe=1`：依次执行三家零额度登录探针，不提交生成。
- `GET /api/settings/generation-jobs`：读取无凭证任务日志，可用 `state` 和 `limit` 过滤。

深度探针在有任何生成任务时自动跳过，避免健康按钮导航或重启正在使用的浏览器页面。
健康结果同时包含 Chrome/Ops Runtime、各平台登录态、调度池占用和历史任务统计。它验证的是
运行时与认证，不代表模型额度或一次真实生成一定成功。

## 协议与回归验证

### Flow 图片 1K / 2K

2026-07-29 用当前 Flow 页面真实生成并分别点击下载确认：

- 1K `Original size` 请求
  `GET /fx/api/trpc/media.getMediaUrlRedirect?name=<原始 mediaId>`，经 307 跳到
  `flow-content.google/image/<mediaId>` 的签名地址；最终响应是原始 JPEG。
- 2K `Upscaled` 请求 `POST https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage`，
  请求体包含原始 `mediaId`、`targetResolution: UPSAMPLE_IMAGE_RESOLUTION_2K` 和带
  `IMAGE_GENERATION` reCAPTCHA 的 `clientContext`。响应为 JSON，`encodedImage` 是最终
  JPEG，`media.name` 是新建的 2K mediaId，并通过 `sourceMediaId/finalMediaId` 同时保留
  原始生成关系。

Provider 不做 Canvas、Sharp 或 FFmpeg 插值。Sharp 只读取最终字节的 metadata：1K 必须
等于生成响应里的原始宽高，2K 必须是同一比例下宽高各 2 倍；缺少源尺寸时，2K 至少要求
长边达到 2048px。校验失败按已提交协议错误处理，不保存、不标记成功。普通图片路由和产品
短视频任务的本地 JSON 都记录 `requestedResolution/actualWidth/actualHeight`。

日常验证不消耗额度：

```bash
npm test
npm run build
npm run test:web-http:live -- --list
```

`test/fixtures/webhttp/` 保存三家脱敏响应样本；协议测试用真实字段形状验证多图、异步视频、
会话标识和任务恢复解析。调度测试用 60 个合成任务验证提交、轮询、下载、取消和重启恢复，
不访问外网。

真实冒烟是手动、双重解锁、严格串行且不自动重试的：

```bash
# 单项；--reference 只在该用例需要参考图时提供
EVAN_LIVE_SMOKE=1 npm run test:web-http:live -- \
  --execute \
  --case image/jimeng-image-5-0-lite/text \
  --workflow-id <已有项目ID>

# 查看所有 51 个“模型 x 已支持模式”用例，不产生请求
npm run test:web-http:live -- --list
```

执行参考图或多参考图用例时重复传入 `--reference <本地图片路径>`。脚本会先做零额度健康
探针，再调用 Evan 的真实 `/api/generate-image` 或 `/api/generate-video`，最后用 HEAD 验证
项目素材文件；Flow 图片还会核对服务端返回的请求分辨率与实际像素 metadata。可用
`--resolution 1K|2K` 覆盖单项用例的默认值；任一失败立即停止。只有 `--all` 或明确筛选
范围才允许执行，避免误跑整套。

## 扩展规则

新增平台或模型按固定顺序落地：

1. 在共享能力表声明 UI 能力，不根据模型名称猜能力。
2. 在协议注册表建立画布 id 到真实协议 id 的显式映射。
3. 把请求构造和响应解析写成纯函数，并加入脱敏协议样本。
4. Provider 只实现上传、提交、轮询、下载；计费请求必须准确标记 `submitted: true`。
5. 在 Generation Provider Registry 登记阶段并发上限。
6. workflow adapter 只做参数归一化，路由契约保持稳定。
7. 补能力矩阵、协议样本、调度和错误边界测试，再由人工选择真实冒烟项。

当前 Scheduler 是单进程锁。源码开发与已安装桌面版同时运行会形成两个独立调度器并争用同一
Profile，仍然禁止同时启动。未来若需要多进程或远程 Worker，应把 Scheduler/Journal 接口
迁到 SQLite 租约或单独 Worker；Provider 和画布 API 不需要随之改写。
