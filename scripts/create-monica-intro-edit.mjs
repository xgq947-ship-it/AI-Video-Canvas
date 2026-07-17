import { createCanvasEditService } from '../server/services/canvasEditPlan.js';

const service = createCanvasEditService({ rootDir: process.cwd() });
const plan = service.createEditPlan({
  workflowId: '05b42a34-ae62-450e-adcb-a3c60a3ddf5f',
  audioFile: '/library/audio/1784207838117_1b05815e_monica_v01_莫妮卡_Amelia_上海第一天.mp3',
  title: '莫妮卡在上海 · 自我介绍第一条',
  videoNodeIds: [
    '41e16ba5-1f4a-4dc8-87c6-9a551fca814c',
    '62df11f7-656c-448a-b13f-ee354a7839e4',
    'a58433e8-2220-497e-a7e1-13181e9b1dd6',
    '5bd85975-e2b7-418c-ae85-6fbde8181be1',
    '4e380fae-27c5-4403-b73d-2b6aacf51c88',
  ],
  segments: [
    { start: 0, end: 4.707, text: 'Okay… I actually moved to Shanghai.', subtitle: '好吧……我真的搬来上海了。' },
    { start: 4.707, end: 9.405, text: 'Hi, I’m Monica. I’m 28, and I’m from California.', subtitle: '大家好，我是莫妮卡，28岁，来自加州。' },
    { start: 9.405, end: 12.238, text: 'I came here for a one-year design job.', subtitle: '我因为一份为期一年的设计工作来到这里。' },
    { start: 12.238, end: 18.127, text: 'I know almost nobody here, and my Chinese is… really bad.', subtitle: '我在这里几乎谁都不认识，中文也……真的很差。' },
    { start: 18.127, end: 22.48, text: 'So this is day one. Let’s see if Shanghai can become home.', subtitle: '所以，这是第一天。看看上海会不会成为我的家。' },
  ],
});
const applied = service.applyEditPlan({ planId: plan.id, confirm: true });
console.log(JSON.stringify({ planId: plan.id, workflowId: applied.workflow.id, renderNodeId: applied.renderNodeId, warnings: plan.warnings }, null, 2));
