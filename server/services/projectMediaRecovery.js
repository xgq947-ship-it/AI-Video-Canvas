import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveWorkflowProjectRoot } from '../utils/projectAssets.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

const asText = (value) => typeof value === 'string' ? value.trim() : '';

const stableRecoveredNodeId = (filename) => {
  const digest = crypto.createHash('sha1').update(filename).digest('hex').slice(0, 16);
  return `recovered-video-${digest}`;
};

const projectVideoUrl = (projectDirName, filename) => (
  `/library/projects/${encodeURIComponent(projectDirName)}/videos/${encodeURIComponent(filename)}`
);

const pathnameOf = (value) => {
  const clean = value.split('?')[0];
  if (!/^https?:\/\//i.test(clean)) return clean;
  try { return new URL(clean).pathname; } catch { return clean; }
};

const collectStrings = (value, output = []) => {
  if (typeof value === 'string') {
    output.push(pathnameOf(value));
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, output));
  }
  return output;
};

const dismissedVideoFiles = (workflow) => new Set(
  Array.isArray(workflow?.dismissedProjectVideoFiles)
    ? workflow.dismissedProjectVideoFiles.map(asText).filter(Boolean)
    : []
);

const referencedProjectVideoFiles = (workflow) => {
  if (!workflow?.projectDirName) return new Set();
  const prefix = `/library/projects/${encodeURIComponent(workflow.projectDirName)}/videos/`;
  const files = new Set();
  for (const value of collectStrings(workflow.nodes || [])) {
    if (!value.startsWith(prefix)) continue;
    const encodedFilename = value.slice(prefix.length).split('/')[0];
    if (!encodedFilename) continue;
    try {
      files.add(decodeURIComponent(encodedFilename));
    } catch {
      files.add(encodedFilename);
    }
  }
  return files;
};

/**
 * Persist the difference between the previously saved canvas and the incoming
 * canvas. A project video that used to have a node and no longer has one was
 * intentionally dismissed by the user, so the orphan recovery pass must not
 * recreate it on the next open. Re-adding the same video clears the dismissal.
 */
export function reconcileDismissedProjectVideos(previousWorkflow, nextWorkflow) {
  if (!nextWorkflow?.projectDirName) return { workflow: nextWorkflow, changed: false };

  const previousReferences = referencedProjectVideoFiles(previousWorkflow);
  const nextReferences = referencedProjectVideoFiles(nextWorkflow);
  const dismissed = dismissedVideoFiles(previousWorkflow);
  const before = [...dismissed].sort();

  for (const filename of previousReferences) {
    if (!nextReferences.has(filename)) dismissed.add(filename);
  }
  for (const filename of nextReferences) dismissed.delete(filename);

  const after = [...dismissed].sort();
  if (after.length > 0) nextWorkflow.dismissedProjectVideoFiles = after;
  else delete nextWorkflow.dismissedProjectVideoFiles;

  return {
    workflow: nextWorkflow,
    changed: before.length !== after.length || before.some((value, index) => value !== after[index]),
  };
}

const readSidecarMetadata = (directory) => {
  const byFilename = new Map();
  let entries = [];
  try {
    entries = fs.readdirSync(directory).filter(filename => filename.toLowerCase().endsWith('.json'));
  } catch {
    return byFilename;
  }

  for (const filename of entries) {
    try {
      const metadata = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
      const mediaFilename = asText(metadata?.filename);
      if (mediaFilename) byFilename.set(mediaFilename, metadata);
    } catch {
      // A broken sidecar must not hide an otherwise playable project video.
    }
  }
  return byFilename;
};

const shotOrder = (metadata, filename) => {
  const id = asText(metadata?.id) || path.basename(filename, path.extname(filename));
  const match = id.match(/(?:shot|镜头)[-_ ]?(\d+)/i);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

const displayNameFor = (metadata, filename) => {
  const manualName = asText(metadata?.displayName || metadata?.resultName || metadata?.originalFilename);
  if (manualName) return manualName;

  const id = asText(metadata?.id);
  const shot = id.match(/(?:shot|镜头)[-_ ]?(\d+)/i);
  if (shot) return `镜头 ${shot[1]}`;
  if (/^final[_-]/i.test(filename)) return '最终成片';
  return path.basename(filename, path.extname(filename));
};

const durationFrom = (metadata) => {
  const value = Number(metadata?.duration);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

const recoveredVideoNode = ({ projectDirName, filename, metadata, index }) => {
  const url = projectVideoUrl(projectDirName, filename);
  const title = displayNameFor(metadata, filename);
  const duration = durationFrom(metadata);
  return {
    id: stableRecoveredNodeId(filename),
    type: 'Video',
    title,
    displayName: title,
    resultName: filename,
    x: (index % 3) * 520,
    y: Math.floor(index / 3) * 420,
    prompt: asText(metadata?.prompt),
    status: 'success',
    resultUrl: url,
    videoSourceType: 'generated',
    videoSourceUrl: url,
    ...(duration ? { videoDuration: duration } : {}),
    videoModel: asText(metadata?.model) || 'project-video',
    aspectRatio: asText(metadata?.aspectRatio) || '9:16',
    resolution: asText(metadata?.resolution) || 'Auto',
    model: asText(metadata?.model) || 'project-video',
    parentIds: [],
    recoveredFromProjectMedia: true,
  };
};

/**
 * Recreate canvas video nodes for media that survived in a project folder while
 * the workflow JSON did not. This is intentionally idempotent: once a recovered
 * URL is persisted in the workflow, subsequent loads leave it untouched.
 */
export function recoverProjectVideoNodes(workflow, { projectsDir } = {}) {
  if (!workflow?.projectDirName || !projectsDir) return { workflow, changed: false, recovered: [] };

  const projectRoot = resolveWorkflowProjectRoot(workflow, projectsDir);
  const videosDir = projectRoot ? path.join(projectRoot, 'videos') : null;
  if (!videosDir || !fs.existsSync(videosDir)) return { workflow, changed: false, recovered: [] };

  let files;
  try {
    files = fs.readdirSync(videosDir)
      .filter(filename => VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase()))
      .filter(filename => {
        try { return fs.statSync(path.join(videosDir, filename)).isFile(); } catch { return false; }
      });
  } catch {
    return { workflow, changed: false, recovered: [] };
  }
  if (files.length === 0) return { workflow, changed: false, recovered: [] };

  const existingUrls = new Set(collectStrings(workflow.nodes || []));
  const dismissed = dismissedVideoFiles(workflow);
  const sidecars = readSidecarMetadata(videosDir);
  const recoverable = files
    .filter(filename => !dismissed.has(filename))
    .filter(filename => !existingUrls.has(projectVideoUrl(workflow.projectDirName, filename)))
    .map(filename => ({ filename, metadata: sidecars.get(filename) || {} }))
    .sort((left, right) => {
      const leftOrder = shotOrder(left.metadata, left.filename);
      const rightOrder = shotOrder(right.metadata, right.filename);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftFinal = /^final[_-]/i.test(left.filename) ? 1 : 0;
      const rightFinal = /^final[_-]/i.test(right.filename) ? 1 : 0;
      if (leftFinal !== rightFinal) return leftFinal - rightFinal;
      return left.filename.localeCompare(right.filename, 'zh-Hans');
    });
  if (recoverable.length === 0) return { workflow, changed: false, recovered: [] };

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const recovered = recoverable.map((item, index) => recoveredVideoNode({
    projectDirName: workflow.projectDirName,
    filename: item.filename,
    metadata: item.metadata,
    index: nodes.length + index,
  }));
  workflow.nodes = [...nodes, ...recovered];
  return { workflow, changed: true, recovered };
}
