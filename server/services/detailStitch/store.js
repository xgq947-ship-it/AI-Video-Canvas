import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { resolveProjectMediaTarget } from '../../utils/projectAssets.js';

const safeSegment = value => (
  String(value || 'detail-stitch').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
  || 'detail-stitch'
);

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

export function getDetailStitchStorage(workflowId, dirs) {
  const imageTarget = resolveProjectMediaTarget(workflowId, 'images', dirs);
  const projectRoot = path.dirname(imageTarget.targetDir);
  const jobsDir = path.join(projectRoot, '.jobs', 'detail-stitch');
  fs.mkdirSync(jobsDir, { recursive: true });
  return { imageTarget, projectRoot, jobsDir };
}

function sidecarPath(workflowId, stitchId, dirs) {
  return path.join(
    getDetailStitchStorage(workflowId, dirs).jobsDir,
    `${safeSegment(stitchId)}.json`,
  );
}

export function detailStitchImageUrl(imageTarget, filename) {
  return `${imageTarget.urlPrefix}/${encodeURIComponent(filename)}`;
}

function rebaseImageUrl(value, imageTarget) {
  if (typeof value !== 'string' || !value || value.startsWith('data:')) return value;
  try {
    const parsed = new URL(value, 'http://evan.local');
    const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const projectsIndex = segments.indexOf('projects');
    if (projectsIndex < 0 || segments[projectsIndex + 2] !== 'images') return value;
    const filename = segments[projectsIndex + 3];
    if (!filename || path.basename(filename) !== filename) return value;
    return detailStitchImageUrl(imageTarget, filename);
  } catch {
    return value;
  }
}

function rebaseRecord(record, workflowId, dirs) {
  const { imageTarget } = getDetailStitchStorage(workflowId, dirs);
  return {
    ...record,
    fullImageUrl: rebaseImageUrl(record.fullImageUrl, imageTarget),
    sources: Array.isArray(record.sources) ? record.sources.map(source => ({
      ...source,
      url: rebaseImageUrl(source.url, imageTarget),
    })) : [],
    slices: Array.isArray(record.slices) ? record.slices.map(slice => ({
      ...slice,
      url: rebaseImageUrl(slice.url, imageTarget),
    })) : [],
  };
}

export function writeDetailStitchRecord(record, dirs) {
  const filePath = sidecarPath(record.workflowId, record.stitchId, dirs);
  const next = { ...record, updatedAt: new Date().toISOString() };
  atomicWriteJson(filePath, next);
  return rebaseRecord(next, next.workflowId, dirs);
}

export function readDetailStitchRecord(workflowId, stitchId, dirs) {
  const filePath = sidecarPath(workflowId, stitchId, dirs);
  if (!fs.existsSync(filePath)) return null;
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (record?.workflowId !== workflowId || record?.stitchId !== stitchId) return null;
  return rebaseRecord(record, workflowId, dirs);
}

/** Resolve a local library URL without allowing traversal outside libraryDir. */
export function resolveDetailStitchImagePath(value, context) {
  if (typeof value !== 'string' || !value || value.startsWith('data:')) return null;
  let pathname = value.split(/[?#]/)[0];
  if (/^https?:\/\//i.test(value)) {
    const parsed = new URL(value);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;
    pathname = parsed.pathname;
  }
  if (!pathname.startsWith('/library/')) return null;
  const libraryRoot = path.resolve(context.libraryDir);
  const candidate = path.resolve(
    libraryRoot,
    decodeURIComponent(pathname.slice('/library/'.length)),
  );
  if (candidate === libraryRoot || !candidate.startsWith(`${libraryRoot}${path.sep}`)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

export const __detailStitchStoreTest = { rebaseImageUrl, safeSegment };
