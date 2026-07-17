# Claude Code 本地剪辑编排

本项目通过本地 MCP 服务让 Claude Code 读取画布、分析完整配音、生成剪辑计划、创建画布副本并调用现有 Remotion 渲染。无需 Anthropic API Key，素材不会上传到 MCP 服务。

安全规则：`create_edit_plan` 只写计划；`apply_edit_plan` 必须显式传 `confirm=true`，且始终创建副本；`undo_edit_plan` 只删除该计划创建的副本，不修改源画布。

可用工具：`list_workflows`、`read_canvas`、`analyze_dialogue`、`create_edit_plan`、`apply_edit_plan`、`render_preview`、`render_status`、`undo_edit_plan`。

运行画布：

```bash
npm run dev
```

本地调试 MCP：

```bash
npm run mcp:claude
```

在 Claude Code 中可以直接说：读取当前莫妮卡画布和完整配音，先分析静音并生成五段剪辑计划；展示计划，等我确认后再创建副本和渲染。

