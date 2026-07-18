#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvasEditService } from '../server/services/canvasEditPlan.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = createCanvasEditService({ rootDir });
const server = new McpServer({ name: 'twitcanva-local-editor', version: '1.0.0' });
const result = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const run = (handler) => async (args) => {
  try { return result(await handler(args)); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }; }
};

server.registerTool('list_workflows', { description: '列出本地 Evan 画布工作流。', inputSchema: {} }, run(() => service.listWorkflows()));
server.registerTool('read_canvas', {
  description: '读取一个画布及视频/音频节点摘要，不修改任何内容。',
  inputSchema: { workflowId: z.string() },
}, run(({ workflowId }) => service.readCanvas(workflowId)));
server.registerTool('analyze_dialogue', {
  description: '用本机 FFmpeg 识别完整配音中的静音区和建议切点，不上传素材。',
  inputSchema: { audioFile: z.string(), noiseDb: z.number().optional(), minSilence: z.number().positive().optional() },
}, run((args) => service.analyzeDialogue(args)));
server.registerTool('create_edit_plan', {
  description: '创建剪辑计划文件但不改画布。segments 是完整配音上的绝对时间段；默认按画布横坐标选择最后 N 个视频。',
  inputSchema: {
    workflowId: z.string(), audioFile: z.string(), title: z.string().optional(), videoNodeIds: z.array(z.string()).optional(),
    segments: z.array(z.object({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().optional(), subtitle: z.string().optional() })).min(1),
  },
}, run((args) => service.createEditPlan(args)));
server.registerTool('apply_edit_plan', {
  description: '确认后把计划应用到新画布副本。永不覆盖源画布；视频原声静音，完整配音保留为一条音轨。',
  inputSchema: { planId: z.string(), confirm: z.boolean() },
}, run((args) => service.applyEditPlan(args)));
server.registerTool('render_preview', {
  description: '提交画布副本到本地 Remotion 服务渲染。需要 Evan 服务运行在 localhost:3001。',
  inputSchema: { workflowId: z.string(), renderNodeId: z.string() },
}, run(async (args) => {
  const built = service.getRenderManifest(args);
  const response = await fetch('http://127.0.0.1:3001/api/render/remotion', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: built.manifest }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  service.updateRenderNode({ ...args, job: body });
  return { ...body, duration: built.duration };
}));
server.registerTool('render_status', {
  description: '查询本地 Remotion 渲染任务状态。', inputSchema: { jobId: z.string() },
}, run(async ({ jobId }) => {
  const response = await fetch(`http://127.0.0.1:3001/api/render/remotion/${encodeURIComponent(jobId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  service.syncRenderJob(body);
  return body;
}));
server.registerTool('undo_edit_plan', {
  description: '确认后删除该计划创建的画布副本，源画布不受影响。', inputSchema: { planId: z.string(), confirm: z.boolean() },
}, run((args) => service.undoEditPlan(args)));

await server.connect(new StdioServerTransport());
