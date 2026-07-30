# Video Remix 本地拆镜管线

Video Remix 的第二个可执行阶段完全在本机完成，不要求 Gemini 登录。它复用安装包内的
FFmpeg / FFprobe，将已保存的参考视频转换成分析代理、镜头时间线和逐镜分析帧。

## 输入与不可变原片

输入必须是当前项目下由 Reference Video 导入流程创建的文件：

```text
video-remix/<remixId>/source/<referenceId>/original.mp4
```

服务端会再次检查项目、Remix、Reference 目录边界并运行 FFprobe。原片只读，转码、场景
检测和抽帧都不会覆盖它。

## 代理与场景检测

分析代理使用以下约束：

- H.264 / yuv420p
- 长边 1280（横屏约 1280×720，竖屏约 720×1280）
- 15 fps
- 有音轨时转为低码率单声道 AAC；无音轨时保持无音轨

场景切分使用 FFmpeg `scene` 分数。本地算法负责毫秒级时间边界，默认阈值为 `0.30`，
工作台允许在 `0.10` 到 `0.70` 之间调整。相邻切点小于 0.35 秒时会被归一化，避免产生
无法分析或生成的碎片镜头。

## 版本化派生文件

每次自动拆镜或手动保存切点都会先写入新的暂存目录；代理、全部 Shot 五帧和清单均成功
后才发布为独立版本：

```text
video-remix/<remixId>/preprocess/
├── current.json
└── run_<timestamp>_<uuid>/
    ├── analysis_proxy.mp4
    ├── shots.json
    └── shots/
        └── shot_001/
            └── frames/
                ├── start.jpg
                ├── quarter.jpg
                ├── middle.jpg
                ├── three_quarter.jpg
                └── end.jpg
```

`shots.json` 保存相对文件名，不保存机器绝对路径或项目目录 URL。项目状态中的 URL 会随
项目改名一起重写。失败的运行只删除自己的暂存目录，不影响原片或上一个成功版本。

## HTTP 接口

```text
POST /api/video-remix/preprocess
PUT  /api/video-remix/shots
```

`POST /preprocess` 生成代理、检测场景并抽取每个 Shot 的 Start / 25% / 50% / 75% /
End 五帧。`PUT /shots` 接受用户调整后的切点，复用现有代理并发布新的 Shot 版本。

工作台支持：

- 在播放头新增切点（拆分）
- 删除切点（合并）
- 用滑块拖动切点
- 撤销未保存修改
- 保存后重建全部 Shot 分析帧

边界发生变化的 Shot 会保留可追踪的 `shotId`，但清空旧语义蓝图，避免把旧时间范围的
AI 分析误用于新镜头；未变化的 Shot 可保留结构化数据。任何切点变更都会使后续 Prompt、
关键帧、生成视频和最终输出失效，必须从新 Shot 时间线继续。
