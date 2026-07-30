# Video Remix 资产系统

Phase 5 把 Gemini 的结构化分析结果转换为可替换、可确认的项目资产。人物、场景和道具
继续使用分析阶段分配的稳定 ID；替换只覆盖资产内容，不修改 Shot 的引用关系和时间线。

## 数据模型

分析结果保留为资产基线，用户选择的内容写入可选 `replacement`：

```ts
interface VideoRemixAssetReplacement {
  source: 'analysis' | 'generated' | 'upload' | 'library'
  name?: string
  description?: string
  referenceImages?: string[]
  generatedPrompt?: string
  updatedAt?: string
}
```

读取当前资产时由 `resolveVideoRemixAsset` 合并基线与 `replacement`。清除替换即可恢复原始
分析结果，不需要再次调用 Gemini。重新分析会更新基线，但会保留用户替换和用户新增的
Character Look。

## 人物与 Character Looks

Character Identity 只描述跨镜头稳定的身份特征，不绑定服装。每个人物可有多个 Look，
每个 Look 有自己的稳定 ID、描述和参考图。

Shot 默认使用分析给出的 `lookId`。用户在资产页选择其他 Look 后，会在该 Shot 的人物
引用上写入：

```json
{
  "lookOverride": {
    "lookId": "LOOK_02",
    "source": "user",
    "locked": true
  }
}
```

这个覆盖只影响目标 Shot，并在重新分析后继续保留。人物声音的语言、性别、年龄感、
音色、音高和说话方式也在资产页编辑，供后续 Prompt 使用。

## 场景与道具

Scene Identity 同时保存视觉描述、环境声音和功能区 `zones`。场景替换会沿用原有 Scene
ID，因此引用该 Scene 的所有 Shot 自动读取新资产。

Prop 保留 `hero | interactive | background` 分类。全局替换仍保留动作和构图引用；
`removed: true` 只让后续生成忽略该道具，不删除分析记录，用户可以随时恢复。

## 资产来源

资产页支持四种来源：

- 沿用 Gemini 反推的截图与描述
- 用户明确点击后，通过现有 Flow、即梦或 Gemini Web 图片 Provider 重新设计
- 上传本地图片到当前项目
- 从现有角色库、场景库或道具库选择

上传使用现有二进制项目图片接口，不把图片编码进画布 JSON。素材库文件也不会直接引用
全局库路径；选择后由现有项目导入接口复制到当前项目，并以源路径哈希生成稳定文件名。
因此项目可以独立迁移，删除或修改素材库原件不会破坏已选资产。

AI 重新设计不会自动运行。只有用户点击“生成并设为当前资产”时才调用所选图片 Provider；
未登录对应平台只会在当前弹窗显示可恢复错误，不影响项目打开、本地资产编辑或其他阶段。

## 确认与派生结果失效

所有 Shot 完成结构化分析后，用户可以确认资产，状态进入 `assets_ready`。任何人物、
Look、Scene、Prop 或单 Shot Look 修改都会：

- 取消资产确认，并把后续阶段退回 `analysis_ready`
- 清空 Raw/Resolved/Optimized Prompt
- 清空关键帧和生成视频
- 移除时间线中的旧 `videoUrl`
- 清空最终输出

Shot ID、时间边界、动作、构图和运镜不受影响。这样可避免旧生成结果继续引用已经替换的
资产，同时保留高复刻工作流的锁定信息。
