# Video Remix Media Resolver 协议记录

最后验证：2026-07-30

## 公开页面协议

目标站点：`https://dyxhsdownloader.com/`

公开页面前端先从用户粘贴的整段文案中提取 URL，然后依次调用两个同源 JSON 接口。

### 1. 展开分享短链

```http
POST /api/resolve
Content-Type: application/json
Accept: application/json
```

```json
{
  "url": "https://www.bilibili.com/video/BV1gW411w7ES/"
}
```

已观察到的响应结构：

```json
{
  "originalUrl": "string",
  "finalUrl": "string",
  "status": "number"
}
```

### 2. 解析媒体

```http
POST /api/parse
Content-Type: application/json
Accept: application/json
```

```json
{
  "url": "<resolve 返回的 finalUrl>",
  "originalUrl": "<用户文案中提取的原始 URL>",
  "userInput": "<用户粘贴的完整文案>"
}
```

视频响应结构：

```json
{
  "success": true,
  "provider": "bilibili",
  "data": {
    "type": "video",
    "title": "string",
    "cover": "https://...",
    "videoUrl": "https://...",
    "videoUrlAlt": "https://...",
    "author": "string",
    "description": "string",
    "watermarkStatus": "removed"
  }
}
```

公开接口的实际请求不要求 Cookie、临时 Token、Origin 或 Referer；无登录状态的直接请求也能完成解析。页面提示 CDN 地址约 5 分钟过期，所以服务端在解析后立即把视频流式下载到当前项目，不把临时 CDN 地址当作持久化素材。

## Evan 适配策略

- `DyXhsDownloaderProvider` 封装第三方协议，画布和工作区不直接依赖接口字段。
- 普通 `.mp4`、`.mov`、`.webm` 直链走同一 Provider 的直链快速路径。
- 图集响应在第一版返回明确的“不支持”错误，不会误存为视频。
- 每次 HTTP 重定向都重新检查目标域名和 DNS 地址，拒绝本机、私网、链路本地和保留地址。
- 下载限制为 1GB，并以流方式写入临时文件；成功后才原子改名。
- 原文件保存在 `project/video-remix/<remixId>/source/<referenceId>/original.<ext>`，后续代理、拆镜和分析不会修改它。
- `metadata.json` 保存 FFprobe 元数据、来源、相对原文件名和 SHA-256；不写死会随项目改名变化的 URL。
- 该阶段不使用 Gemini，也不依赖 Gemini Web 登录状态。

协议回归测试位于：

- `test/videoRemixMediaResolver.test.mjs`
- `test/videoRemixReferenceVideo.test.mjs`
