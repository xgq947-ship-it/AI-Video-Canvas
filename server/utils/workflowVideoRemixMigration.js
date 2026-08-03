import fs from 'fs';
import path from 'path';

export const VIDEO_REMIX_WORKSPACE_BACKUP_SUFFIX = '.pre-video-remix-workspace-v2.bak';

function legacyRemixIds(workflow) {
  return new Set((workflow?.nodes || [])
    .filter(node => node?.type === 'Video Remix')
    .map(node => String(node.videoRemix?.remixId || node.id || ''))
    .filter(Boolean));
}

function projectRemixIds(workflow) {
  return new Set((workflow?.videoRemixes || [])
    .map(project => String(project?.id || project?.state?.remixId || ''))
    .filter(Boolean));
}

export function isVideoRemixWorkspaceMigration(existingWorkflow, nextWorkflow) {
  const legacyIds = legacyRemixIds(existingWorkflow);
  if (legacyIds.size === 0) return false;
  const nextLegacyIds = legacyRemixIds(nextWorkflow);
  const nextProjectIds = projectRemixIds(nextWorkflow);
  return [...legacyIds].every(id => !nextLegacyIds.has(id) && nextProjectIds.has(id));
}

export function videoRemixWorkspaceBackupPath(workflowPath) {
  const extension = path.extname(workflowPath);
  const base = extension ? workflowPath.slice(0, -extension.length) : workflowPath;
  return `${base}${VIDEO_REMIX_WORKSPACE_BACKUP_SUFFIX}`;
}

export function writeJsonAtomicSync(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/** Writes one immutable pre-migration backup before the legacy node is removed. */
export function ensureVideoRemixWorkspaceMigrationBackup(
  existingWorkflow,
  nextWorkflow,
  workflowPath
) {
  if (!isVideoRemixWorkspaceMigration(existingWorkflow, nextWorkflow)) return null;
  const backupPath = videoRemixWorkspaceBackupPath(workflowPath);
  if (!fs.existsSync(backupPath)) writeJsonAtomicSync(backupPath, existingWorkflow);
  return backupPath;
}
