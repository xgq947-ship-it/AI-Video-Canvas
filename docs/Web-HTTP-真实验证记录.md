# Web HTTP 真实验证记录

验证日期：2026-07-28。执行环境为当时的 Evan 专属 Chrome 登录态（现已迁移到系统共享
AI Browser Hub Profile），生成请求全部由 HTTP provider 发出；浏览器只提供会话、Cookie、
Bearer 与 reCAPTCHA，不执行 DOM 点击生成。

## 即梦

| 模型 | 文生图 | 单图生图 | 多参考图 | 单次多图 | 视频 |
| --- | --- | --- | --- | --- | --- |
| 图片 5.0 Lite | 通过 | 通过 | 2 图 → 8 张通过 | 8 张通过 | 不适用 |
| 图片 5.0 Pro | 账号返回积分/权益不足 | 同一额度边界 | 同一额度边界 | 同一额度边界 | 不适用 |
| Seedance 2.0 系列 | 不适用 | 不适用 | 不适用 | 不适用 | 五个模型均到达真实权益校验，账号仅 2 积分 |

图片 5.0 Lite 为本账号免费模型，成功结果已写入 `library/projects/冒烟测试项目/images/`。
本轮新增的文生图 8 张与 2 张参考图生 8 张均返回 8/8 个 2048×2048 PNG。Pro/视频的
额度错误不得归因到 Lite。

即梦视频五个画布模型都用页面模型表里的精确 `model_req_key` 发出过真实 HTTP 请求：

| 画布模型 | 协议模型 | 真实结果 |
| --- | --- | --- |
| Seedance 2.0 mini | `dreamina_seedance_40_mini` | 积分/权益不足 |
| Seedance 2.0 Fast VIP | `dreamina_seedance_40_vision` | 积分/权益不足 |
| Seedance 2.0 VIP | `dreamina_seedance_40_pro_vision` | 积分/权益不足 |
| Seedance 2.0 Fast | `dreamina_seedance_40` | 积分/权益不足 |
| Seedance 2.0 | `dreamina_seedance_40_pro` | 积分/权益不足 |

因此当前账号无法完成即梦视频的文生、单图、多参考图成片验证；系统不会把权益错误伪装成
协议通过，也不会在已提交后自动改模型重试。

## Google Flow

| 模型 | 文生图/视频 | 单图/首帧 | 多参考图 | 多张图片 | 原生音频 |
| --- | --- | --- | --- | --- | --- |
| Nano Banana Pro | 通过 | 通过 | 2 图通过 | 4 张通过 | 不适用 |
| Nano Banana 2 | 通过 | 通过 | 2 图通过 | 4 张通过 | 不适用 |
| Nano Banana 2 Lite | 通过 | 通过 | 2 图通过 | 4 张通过 | 不适用 |
| Omni Flash | 通过 | 通过 | 2 图真实成片通过 | 不适用 | AAC 非静音 |
| Veo 3.1 - Lite | 通过 | 通过 | 通过 | 不适用 | AAC 非静音 |
| Veo 3.1 - Fast | 通过 | 通过 | 平台 15 分钟未完成；未重提 | 不适用 | 已完成结果 AAC 非静音 |
| Veo 3.1 - Quality | 通过 | 通过 | 页面不支持，API 提交前拒绝 | 不适用 | AAC 非静音 |

多参考图提交请求必须使用 `referenceImages`，并为每个媒体携带
`imageUsageType: IMAGE_USAGE_TYPE_ASSET`；Flow 成功写入项目历史后会规范化为
`videoGenerationImageInputs` 中的 `IMAGE_USAGE_TYPE_ASSET_IMAGE`。提交 schema 与历史 schema 的枚举不能混用。Fast/Quality 的协议键来自
当前 Flow 页面请求抓包，不按命名猜测。模型健康状态来自当前账号的
`/v1/flow/models/statuses`。Fast 多参考图超时后再次查询项目历史仍没有结果，保持未通过，
不自动重复提交。

2026-08-06 电影分镜单镜头真实验证：4 张参考图均上传成功，视频提交也返回了 Flow
media ID；按 Flow 页面实际使用的 `video:batchCheckAsyncVideoGenerationStatus` 查询后，
任务明确返回 `MEDIA_GENERATION_STATUS_FAILED`、`PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED`、
`PROMINENT_PERSON`，并标记为 `FILTERED`。这说明此前“持续生成中”不是上传失败，而是旧实现只轮询项目历史，
无法看见尚未物化的失败状态；现已接入异步状态接口，UI 会直接显示失败原因，不再等待到超时。

同日用无人物素材完成 Omni Flash 两张参考图真实成片验证。HTTP 链路依次完成 2 张图片上传、
`video:batchAsyncGenerateVideoReferenceImages` 提交、
`video:batchCheckAsyncVideoGenerationStatus` 从 `ACTIVE` 轮询到成功、结果下载和本地保存；
提交使用 `abra_r2v_8s`、`referenceImages` 与 `IMAGE_USAGE_TYPE_ASSET`，Flow media ID 为
`edcb0d40-8fb5-4f67-a123-e1da419112ed`。产物
`/library/projects/火柴人-拖延症/videos/vid_1785991219947_9ojkts3by.mp4` 经 FFprobe 验收为
8.000 秒、1280×720、24 fps、H.264 High + 48 kHz 双声道 AAC，音轨均值 -23.1 dB、峰值 -5.0 dB；
中间帧同时包含大象与鲸鱼，证明两张参考图都实际参与生成。该成功请求的完整协议形状已固化到
`test/webHttpProtocol.test.mjs`，防止后续把提交枚举、模型 key 或状态接口改回错误版本。

## Gemini Web

| 能力 | 结果 |
| --- | --- |
| 文生图 | HTTP 到达生成服务；账号返回图片额度待重置 |
| 单图生图 | 上传与 HTTP 请求通过；账号返回图片额度待重置 |
| 多参考图生图 | 2 图上传与 HTTP 请求通过；账号返回图片额度待重置 |
| 多张图片 | 当前网页单次不支持，提交前限制为 1 张 |
| 文生视频 | 通过，10 秒 1280×720，H.264 + 非静音 AAC |
| 单图生视频 | 通过，10 秒 1280×720，H.264 + 非静音 AAC |
| 多参考图视频 | 当前网页只暴露 1 个文件输入，不支持、不测试 |

视频提交使用当前 97 项 `StreamGenerate` 信封，异步结果通过 `hNvQHb` 会话 RPC 低频轮询；
轮询不会重新提交生成请求。当前网页没有时长选择器，两次真实 HTTP 成片均为 10.005 秒，
因此能力表固定为 10 秒，不再沿用未验证的 8 秒假设。

## 稳定性边界

- 计费请求一旦提交，任何传输失败或轮询超时都标记 `submitted=true`，禁止自动重试。
- 超时错误保留 Flow media ID、Gemini conversation ID 或即梦 submit ID，便于从平台历史恢复。
- Flow/Gemini 视频成功结果必须通过容器、视频流、音轨和非静音检查后才记为通过。
- 平台不支持的模式在提交前拒绝；账号额度不足与协议错误分开报告。
- 即梦 Lite/Pro 的批量上限分别为 8/4，Pro 参考图上限为 10；五个视频模型按真实表约束
  4-15 秒、9 张参考图以及各自分辨率，不能把 VIP 的 4K 参数误发给 720P 档位。
