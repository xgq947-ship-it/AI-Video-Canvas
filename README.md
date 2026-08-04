<div align="center">
  <img src="public/TwitCanva-logo.png" alt="Evan Logo" width="120" />
  <h1>Evan AI Video Canvas</h1>
</div>

Evan 是一个本地优先的 AI 图片、视频与漫剧生产桌面应用。画布、项目、素材、浏览器
登录资料和本地渲染都保存在用户电脑；Google Flow、Gemini Web、即梦及 API 模型的
生成计算由对应官方服务完成。

## 普通用户

安装版已经内置 Electron 后端、FFmpeg/FFprobe 和独立自动化运行时，不要求用户安装
Node.js、Python 或 Chrome Beta，但电脑必须安装可自动更新的正式版 Google Chrome。
普通画布、Flow/Gemini Web/即梦和本地渲染不依赖 Codex；只有选择“Codex 生图”等可选
高级能力时，才需要用户单独安装并登录最新版 Codex CLI。Evan 不捆绑固定 Codex 版本。

- [macOS 首次安装与使用](docs/首次安装使用-macOS.md)
- [Windows 首次安装与使用](docs/首次安装使用-Windows.md)
- [当前项目说明](docs/项目说明.md)

首次使用 Google Flow、Gemini Web 或即梦时，从应用设置中打开系统共享 AI 浏览器登录，完成后点击
“检查登录状态”。只有真实页面探针确认账号已登录，界面才显示“已验证”。之后生图和生视频默认
在后台无头运行。Hub 已内置在安装包中，用户无需额外安装；同一电脑上的三开 AI App 共用一份
独立 Profile 和一个按需运行的 Chrome，不会读取用户日常 Chrome Profile。

新建项目时可以保留 Evan 默认位置，也可以用系统文件夹选择器将完整项目放到桌面、其他
工作目录或其他磁盘。项目文件夹包含画布 `project.json` 及图片、视频、音频素材。

主界面统一为“画布 / 资产”。短视频复刻作为画布内的“视频分析”节点：固定接收参考视频、
产品参考图、人物参考图和场景参考图，点击分析后自动生成关键帧、镜头视频和最终成片节点；
这些节点复用现有图片、视频、Render、队列和模型能力，生成顺序由连线语义决定，不依赖
`parentIds` 顺序。右键已有画布视频可直接创建分析节点；旧版独立复刻项目会在打开时幂等迁移
为画布节点，并保留原项目数据作为兼容记录。范围与验证结果见[视频复刻 MVP 验收说明](docs/video-remix-mvp-acceptance.md)。

## 开发者

```bash
npm install
npm run setup
npm run setup:automation-runtime
npm start
```

常用验证与打包：

```bash
npm test
npm run build
npm run desktop:dist:mac   # 必须在 macOS 上运行
npm run desktop:dist:win   # 必须在 Windows x64 上运行
```

平台运行时包含平台相关二进制，不能在 macOS 上直接生成可信的 Windows 完整安装包。
仓库提供 `.github/workflows/desktop-installers.yml`，会分别在原生 macOS/Windows runner
生成安装介质、创建 GitHub Release，并在发布成功后删除 Actions 临时产物。完整说明见
[开发指南](docs/development.md)、[发布与跨电脑开发](docs/发布与跨电脑开发.md)、
[桌面运行时架构](docs/desktop-runtime-architecture.md) 和
[三平台生成运行时架构](docs/generation-runtime-architecture.md)。

## 文档

- [AI 漫剧 0—1 工作流](docs/AI漫剧0-1工作流.md)
- [Remotion 渲染说明](docs/Remotion渲染说明.md)
- [项目数据格式](docs/项目数据格式.md)
- [视频剪辑节点](docs/video-editor-node.md)
- [视频复刻使用教程（HTML）](docs/video-remix-user-guide.html)
- [视频复刻 MVP 验收说明](docs/video-remix-mvp-acceptance.md)
- [Modal 相机角度服务](docs/modal-camera-integration.md)
- [三平台生成运行时架构](docs/generation-runtime-architecture.md)

Copyright © 2025 SankaiAI. Licensed under the Apache License, Version 2.0.
