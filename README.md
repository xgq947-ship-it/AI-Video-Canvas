<div align="center">
  <img src="public/TwitCanva-logo.png" alt="Evan Logo" width="120" />
  <h1>Evan AI Video Canvas</h1>
</div>

Evan 是一个本地优先的 AI 图片、视频与漫剧生产桌面应用。画布、项目、素材、浏览器
登录资料和本地渲染都保存在用户电脑；Google Flow、即梦及 API 模型的生成计算由对应
官方服务完成。

## 普通用户

安装版已经内置 Electron 后端、Chromium、FFmpeg/FFprobe 和独立自动化运行时，不要求
用户安装 Node.js、Python、Chrome 或 Chrome Beta。普通画布、Flow/即梦和本地渲染也不
依赖 Codex；只有选择“Codex 生图”等可选高级能力时，才需要用户单独安装并登录最新版
Codex CLI。Evan 不捆绑固定 Codex 版本。

- [macOS 首次安装与使用](docs/首次安装使用-macOS.md)
- [Windows 首次安装与使用](docs/首次安装使用-Windows.md)
- [当前项目说明](docs/项目说明.md)

首次使用 Google Flow 或即梦时，只需从应用设置中打开内置浏览器，分别登录自己的账号。
之后生图和生视频默认在后台无头运行；登录过期时画布会提示重新登录，不会自动抢占前台。

新建项目时可以保留 Evan 默认位置，也可以用系统文件夹选择器将完整项目放到桌面、其他
工作目录或其他磁盘。项目文件夹包含画布 `project.json` 及图片、视频、音频素材。

## 开发者

```bash
npm install
npm run setup
npm run setup:browser-models
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
[开发指南](docs/development.md)、[发布与跨电脑开发](docs/发布与跨电脑开发.md) 和
[桌面运行时架构](docs/desktop-runtime-architecture.md)。

## 文档

- [AI 漫剧 0—1 工作流](docs/AI漫剧0-1工作流.md)
- [Remotion 渲染说明](docs/Remotion渲染说明.md)
- [项目数据格式](docs/项目数据格式.md)
- [视频剪辑节点](docs/video-editor-node.md)
- [Modal 相机角度服务](docs/modal-camera-integration.md)

Copyright © 2025 SankaiAI. Licensed under the Apache License, Version 2.0.
