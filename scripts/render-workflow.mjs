import fs from 'node:fs';
import path from 'node:path';
import { createCanvasEditService } from '../server/services/canvasEditPlan.js';
import { renderManifest } from '../server/services/remotionRender.js';

const [workflowId, renderNodeId, outputName = `${workflowId}.mp4`] = process.argv.slice(2);
if (!workflowId || !renderNodeId) {
  throw new Error('Usage: node scripts/render-workflow.mjs <workflowId> <renderNodeId> [outputName.mp4]');
}
if (!/^[a-zA-Z0-9_-]+$/.test(workflowId) || !/^[a-zA-Z0-9_-]+$/.test(renderNodeId)) {
  throw new Error('Invalid workflow or render node ID');
}
if (path.basename(outputName) !== outputName || !outputName.endsWith('.mp4')) {
  throw new Error('Output name must be a plain .mp4 filename');
}

const root = process.cwd();
const libraryDir = path.join(root, 'library');
const workflowPath = path.join(libraryDir, 'workflows', `${workflowId}.json`);
const outputPath = path.join(libraryDir, 'renders', outputName);
const service = createCanvasEditService({ rootDir: root });
const { manifest, duration } = service.getRenderManifest({ workflowId, renderNodeId });

console.log(`Manifest duration: ${duration}s`);
const result = await renderManifest({
  manifest,
  libraryDir,
  outputPath,
  onProgress: ({ stage, progress }) => process.stdout.write(`\r${stage} ${(progress * 100).toFixed(0)}%   `),
});

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const renderNode = workflow.nodes.find((node) => node.id === renderNodeId && node.type === 'Render');
if (!renderNode) throw new Error('Render node not found after render');
renderNode.renderStatus = 'success';
renderNode.renderStage = 'done';
renderNode.renderProgress = 1;
renderNode.renderOutputUrl = `/library/renders/${outputName}`;
renderNode.renderError = null;
workflow.updatedAt = new Date().toISOString();
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);

console.log(`\n${JSON.stringify(result)}`);
