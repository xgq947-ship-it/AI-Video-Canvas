# Video Remix Gemini 结构化分析

Phase 4 在本地拆镜之后运行。业务层只暴露 `fast` / `deep` 两个分析档位，通过
`VideoAnalyzerProvider` 调用首个实现 `GeminiVideoAnalyzer`；React 工作台不依赖 Gemini
内部模型 ID 或 Web HTTP 协议字段。

## 两层分析

### 全片分析

`POST /api/video-remix/analysis/global`

完整的 `analysis_proxy.mp4` 在一次分析运行中只上传一次，用于建立：

- 故事摘要、类型、结构和整体视觉风格
- 全局 Character Identity 与分离的 Looks
- Scene Identity 与 Scene Zones
- 重要 Props
- 覆盖每个 Shot 的 `simple | medium | complex` 分类和置信度

分析代理复用 Browser Hub 的二进制上传通道，单文件上限为 24 MB。服务端会在把文件读入
内存或启动登录浏览器之前检查大小，并返回可重试错误；原始参考视频不会因此被修改。

本地 Shot ID 和毫秒级边界作为只读约束随 Prompt 提供，AI 不负责重新切镜。

### 逐 Shot 分析

`POST /api/video-remix/analysis/shot`

输入按全片阶段的复杂度自动选择：

| 复杂度 | 分析输入 |
| --- | --- |
| Simple | Start / Middle / End |
| Medium | Start / 25% / 50% / 75% / End |
| Complex | 从分析代理精确裁出的完整 Shot 小视频 |

每个 Shot 单独请求、校验、保存和重试。一个 Shot 失败不会清除全片结果或其他已完成
Shot。

## 严格结构契约

Gemini Web 的现有 StreamGenerate 协议没有可安全复用的公开 `responseSchema` 字段，因此
没有臆造协议参数。实现采用两道强约束：

1. Prompt 要求只返回单个纯 JSON 对象；Markdown、代码围栏和 JSON 前后自由文本会直接
   被拒绝。
2. 全片和 Shot 分别通过严格 Zod Schema 校验，未知字段、缺字段、重复 ID、未知资产
   引用、越界时间和错误枚举都会失败。

结构失败会在同一 Gemini conversation 中发送校验错误并自动纠正；后续纠正请求不再
附带已经上传的视频或帧。`fast` 最多两次，`deep` 最多三次。连续失败后只标记当前
全片步骤或 Shot 为可重试错误，不把未校验文本写入项目状态。

## EditableField 与重分析

AI 重要字段统一转换为：

```json
{
  "value": "medium shot",
  "source": "ai",
  "confidence": 0.91,
  "locked": false
}
```

用户在分析页修改后会变为 `source: "user", locked: true`。重新分析和磁盘恢复都会递归
保留 `user + locked` 字段；用户可主动解除锁定，让下一次分析覆盖。

## 增量持久化与恢复

每次全片分析创建独立运行目录：

```text
video-remix/<remixId>/analysis/
├── current.json
└── run_<timestamp>_<uuid>/
    ├── global.json
    └── shots/
        ├── shot_001.json
        └── shot_002.json
```

签名包含原视频哈希、分析档位和 Shot 时间线。参考视频或切点变化后，旧分析不会被错误
恢复。工作台打开分析页时会读取本地快照，补回应用关闭前已经完成但尚未来得及写入画布
状态的结果。

## 未登录行为

导入、代理、拆镜和 Shot 编辑不检查 Gemini 登录。只有用户主动点击分析时才读取 Gemini
Web 会话。未登录或登录失效会返回 `AUTH_EXPIRED`，工作台显示“打开 Gemini 登录”与
“重试未完成 Shot”；已完成结果不会丢失，也不会从头上传或重做整条任务。
