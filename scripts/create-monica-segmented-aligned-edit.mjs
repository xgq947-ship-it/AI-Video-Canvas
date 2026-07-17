import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowsDir = path.join(root, 'library', 'workflows');
const sourceId = '068f5295-c1df-4738-9457-5a49fd34cf8b';
const source = JSON.parse(fs.readFileSync(path.join(workflowsDir, `${sourceId}.json`), 'utf8'));
const workflow = structuredClone(source);
const now = new Date().toISOString();

workflow.id = crypto.randomUUID();
workflow.title = '莫妮卡在上海 · 分句配音口型校准版';
workflow.createdAt = now;
workflow.updatedAt = now;
delete workflow.coverUrl;

const oldEditNodeIds = new Set([
  '61f6fa5d-ec31-4c5c-b57d-c4ee182e2a88',
  '1733ac96-f1b5-4d3a-966c-7cd221a5a0bd',
  '12330be0-1de5-4ad1-9a39-219fd3fb4aff',
  'd7ec81c5-d224-4ebb-973c-891f061dc079',
  'b7ee75c8-2901-4dd7-8807-cdb7422718eb',
  '780a6df8-9d78-453a-8775-0cf86f4c8d30',
  '4d9561f3-b235-4aa4-899f-966672c4f1a5',
]);
workflow.nodes = workflow.nodes.filter((node) => !oldEditNodeIds.has(node.id));

const shots = [
  ['41e16ba5-1f4a-4dc8-87c6-9a551fca814c', 4.707],
  ['62df11f7-656c-448a-b13f-ee354a7839e4', 4.698],
  ['a58433e8-2220-497e-a7e1-13181e9b1dd6', 2.833],
  ['5bd85975-e2b7-418c-ae85-6fbde8181be1', 6.12],
  ['4e380fae-27c5-4403-b73d-2b6aacf51c88', 5.95],
];
shots.forEach(([id, trimEnd], index) => {
  const node = workflow.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`Missing video node: ${id}`);
  node.order = index + 1;
  node.trimStart = 0;
  node.trimEnd = trimEnd;
  node.shotVolume = 0;
});

const lines = [
  {
    file: '/library/audio/monica_v02_line01.mp3',
    duration: 3.28,
    start: 0.1,
    text: '好吧……我真的搬来上海了。',
  },
  {
    file: '/library/audio/monica_v02_line02.mp3',
    duration: 3.76,
    start: 4.707,
    text: '大家好，我是莫妮卡，28岁，来自加州。',
  },
  {
    file: '/library/audio/monica_v02_line03.mp3',
    duration: 2.08,
    start: 9.405,
    text: '我因为一份为期一年的设计工作来到这里。',
  },
  {
    file: '/library/audio/monica_v02_line04.mp3',
    duration: 4.72,
    start: 13.428,
    text: '我在这里几乎谁都不认识，中文也……真的很差。',
  },
  {
    file: '/library/audio/monica_v02_line05_aligned.mp3',
    duration: 4.45,
    start: 19.408,
    text: '所以，这是第一天。看看上海会不会成为我的家。',
  },
];

const maxX = Math.max(0, ...workflow.nodes.map((node) => Number(node.x) || 0));
const audioNodes = lines.map((line, index) => ({
  id: crypto.randomUUID(),
  type: 'Audio',
  title: `莫妮卡 Amelia 分句 ${index + 1}`,
  x: maxX + 450,
  y: index * 150,
  prompt: '',
  status: 'success',
  model: 'eleven_v3',
  aspectRatio: '9:16',
  resolution: 'Auto',
  parentIds: [],
  mediaUrl: line.file,
  durationSec: line.duration,
  timelineStart: line.start,
  timelineEnd: Number((line.start + line.duration).toFixed(3)),
  audioVolume: 1,
  fadeIn: 0,
  fadeOut: 0,
  speaker: '莫妮卡',
  voiceId: 'amelia',
  ttsSource: 'generated',
  ttsProvider: 'chatcut-elevenlabs',
}));

const subtitleNodes = lines.map((line, index) => ({
  id: crypto.randomUUID(),
  type: 'Subtitle',
  title: `字幕 ${index + 1}`,
  x: maxX + 850,
  y: index * 150,
  prompt: line.text,
  subtitleText: line.text,
  status: 'success',
  model: '',
  aspectRatio: '9:16',
  resolution: 'Auto',
  parentIds: [],
  timelineStart: line.start,
  timelineEnd: Number((line.start + line.duration).toFixed(3)),
  speaker: '莫妮卡',
}));

const renderNode = {
  id: crypto.randomUUID(),
  type: 'Render',
  title: '莫妮卡自我介绍成片 · 分句口型校准',
  x: maxX + 1300,
  y: 500,
  prompt: '',
  status: 'idle',
  model: '',
  aspectRatio: '9:16',
  resolution: '1080p',
  compWidth: 1080,
  compHeight: 1920,
  compFps: 24,
  endFadeToBlack: 0.6,
  parentIds: [
    ...shots.map(([id]) => id),
    ...audioNodes.map((node) => node.id),
    ...subtitleNodes.map((node) => node.id),
  ],
};

workflow.nodes.push(...audioNodes, ...subtitleNodes, renderNode);
fs.writeFileSync(path.join(workflowsDir, `${workflow.id}.json`), `${JSON.stringify(workflow, null, 2)}\n`);
console.log(JSON.stringify({ workflowId: workflow.id, renderNodeId: renderNode.id }, null, 2));
