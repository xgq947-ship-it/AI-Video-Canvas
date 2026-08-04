import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildManifestFromNodes, computeTotalDurationSec, validateManifestShape } from '../../shared/manifest.js';
import { FFMPEG_PATH, FFPROBE_PATH } from '../runtime/mediaTools.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value) => Math.round(Number(value) * 1000) / 1000;

export const createCanvasEditService = ({ rootDir = path.resolve(process.cwd()) } = {}) => {
  const libraryDir = path.join(rootDir, 'library');
  const workflowsDir = path.join(libraryDir, 'workflows');
  const plansDir = path.join(libraryDir, 'edit-plans');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(plansDir, { recursive: true });

  const safeId = (value, label = 'ID') => {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(value || ''))) throw new Error(`${label} 非法`);
    return String(value);
  };

  const workflowPath = (id) => path.join(workflowsDir, `${safeId(id, 'workflowId')}.json`);
  const planPath = (id) => path.join(plansDir, `${safeId(id, 'planId')}.json`);

  const resolveLibraryAsset = (assetUrl) => {
    const clean = String(assetUrl || '').split('?')[0].split('#')[0];
    const relative = clean.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?library\//, '').replace(/^\/+/, '');
    if (!relative || relative.split('/').includes('..')) throw new Error('素材地址必须位于 library 目录');
    const absolute = path.resolve(libraryDir, relative);
    if (absolute !== libraryDir && !absolute.startsWith(`${libraryDir}${path.sep}`)) throw new Error('素材地址越界');
    if (!fs.existsSync(absolute)) throw new Error(`素材不存在: ${assetUrl}`);
    return { absolute, url: `/library/${relative.replace(/\\/g, '/')}` };
  };

  const readJson = (file, missingMessage) => {
    if (!fs.existsSync(file)) throw new Error(missingMessage);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

  const probeDuration = (assetUrl) => {
    const { absolute } = resolveLibraryAsset(assetUrl);
    const result = spawnSync(FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', absolute], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`ffprobe 失败: ${result.stderr.trim()}`);
    const duration = Number(result.stdout.trim());
    if (!(duration > 0)) throw new Error('无法读取素材时长');
    return round(duration);
  };

  const listWorkflows = () => fs.readdirSync(workflowsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(workflowsDir, name), '工作流不存在'))
    .map((workflow) => ({
      id: workflow.id,
      title: workflow.title,
      updatedAt: workflow.updatedAt,
      nodeCount: workflow.nodes?.length || 0,
      videoCount: workflow.nodes?.filter((node) => node.type === 'Video').length || 0,
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  const readCanvas = (workflowId) => {
    const workflow = readJson(workflowPath(workflowId), '工作流不存在');
    const nodes = workflow.nodes || [];
    return {
      workflow,
      summary: {
        id: workflow.id,
        title: workflow.title,
        nodeCount: nodes.length,
        videos: nodes.filter((node) => node.type === 'Video').map((node) => ({
          id: node.id,
          title: node.title || '视频',
          file: node.resultUrl || node.mediaUrl,
          duration: node.videoDuration,
          x: node.x,
          y: node.y,
        })),
        audio: nodes.filter((node) => ['Audio', 'SFX', 'BGM'].includes(node.type)).map((node) => ({ id: node.id, type: node.type, file: node.mediaUrl || node.resultUrl })),
      },
    };
  };

  const analyzeDialogue = ({ audioFile, noiseDb = -38, minSilence = 0.18 }) => {
    const asset = resolveLibraryAsset(audioFile);
    const duration = probeDuration(asset.url);
    const result = spawnSync(FFMPEG_PATH, [
      '-hide_banner', '-nostats', '-i', asset.absolute,
      '-af', `silencedetect=noise=${Number(noiseDb)}dB:d=${Number(minSilence)}`,
      '-f', 'null', '-',
    ], { encoding: 'utf8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const starts = [...output.matchAll(/silence_start:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    const ends = [...output.matchAll(/silence_end:\s*([0-9.]+)/g)].map((match) => Number(match[1]));
    const silences = starts.map((start, index) => ({
      start: round(start),
      end: round(ends[index] ?? duration),
      duration: round((ends[index] ?? duration) - start),
      suggestedCut: round((start + (ends[index] ?? duration)) / 2),
    }));
    return { audioFile: asset.url, duration, silences };
  };

  const validateSegments = (segments) => {
    if (!Array.isArray(segments) || segments.length === 0) throw new Error('segments 不能为空');
    let previousEnd = 0;
    return segments.map((segment, index) => {
      const start = round(segment.start);
      const end = round(segment.end);
      if (start < 0 || end <= start || (index > 0 && start < previousEnd)) throw new Error(`第 ${index + 1} 段时间非法或重叠`);
      previousEnd = end;
      return { start, end, text: String(segment.text || ''), subtitle: String(segment.subtitle || segment.text || '') };
    });
  };

  const createEditPlan = ({ workflowId, audioFile, segments, videoNodeIds, title }) => {
    const { workflow, summary } = readCanvas(workflowId);
    const normalizedSegments = validateSegments(segments);
    const audio = resolveLibraryAsset(audioFile);
    const audioDuration = probeDuration(audio.url);
    if (normalizedSegments.at(-1).end > audioDuration + 0.1) throw new Error('最后一段超出音频时长');

    const allVideos = summary.videos;
    const selected = Array.isArray(videoNodeIds) && videoNodeIds.length
      ? videoNodeIds.map((id) => allVideos.find((video) => video.id === id)).filter(Boolean)
      : allVideos.sort((a, b) => Number(a.x || 0) - Number(b.x || 0)).slice(-normalizedSegments.length);
    if (selected.length !== normalizedSegments.length) throw new Error(`需要 ${normalizedSegments.length} 个视频节点，实际选择 ${selected.length} 个`);

    const warnings = [];
    const shots = selected.map((video, index) => {
      const sourceDuration = Number(video.duration) || probeDuration(video.file);
      const targetDuration = round(normalizedSegments[index].end - normalizedSegments[index].start);
      if (sourceDuration + 0.03 < targetDuration) warnings.push(`镜头 ${index + 1} 比对白短 ${round(targetDuration - sourceDuration)} 秒，将出现尾部画面不足`);
      return { nodeId: video.id, file: video.file, sourceDuration: round(sourceDuration), trimStart: 0, trimEnd: round(Math.min(sourceDuration, targetDuration)), targetDuration };
    });

    const now = new Date().toISOString();
    const plan = {
      id: crypto.randomUUID(),
      version: 1,
      status: 'draft',
      sourceWorkflowId: workflow.id,
      title: title || `${workflow.title || '未命名项目'} · 对白剪辑`,
      audio: { file: audio.url, duration: audioDuration },
      segments: normalizedSegments,
      shots,
      warnings,
      createdAt: now,
      updatedAt: now,
    };
    writeJson(planPath(plan.id), plan);
    return plan;
  };

  const applyEditPlan = ({ planId, confirm = false }) => {
    if (!confirm) throw new Error('未确认：apply_edit_plan 必须传 confirm=true');
    const plan = readJson(planPath(planId), '剪辑计划不存在');
    if (plan.status === 'applied') return { plan, workflow: readJson(workflowPath(plan.appliedWorkflowId), '已应用副本不存在') };
    const source = readJson(workflowPath(plan.sourceWorkflowId), '源工作流不存在');
    const workflow = clone(source);
    const now = new Date().toISOString();
    workflow.id = crypto.randomUUID();
    workflow.title = `${plan.title} · Claude副本`;
    workflow.createdAt = now;
    workflow.updatedAt = now;
    delete workflow.coverUrl;

    const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
    plan.shots.forEach((shot, index) => {
      const node = nodeById.get(shot.nodeId);
      if (!node) throw new Error(`视频节点不存在: ${shot.nodeId}`);
      node.order = index + 1;
      node.trimStart = shot.trimStart;
      node.trimEnd = shot.trimEnd;
      node.shotVolume = 0;
    });

    const maxX = Math.max(0, ...workflow.nodes.map((node) => Number(node.x) || 0));
    const minY = Math.min(0, ...plan.shots.map((shot) => Number(nodeById.get(shot.nodeId)?.y) || 0));
    const audioNode = {
      id: crypto.randomUUID(), type: 'Audio', title: '莫妮卡完整配音', x: maxX + 450, y: minY,
      prompt: '', status: 'success', model: '', aspectRatio: '9:16', resolution: 'Auto', parentIds: [],
      mediaUrl: plan.audio.file, durationSec: plan.audio.duration, timelineStart: 0, timelineEnd: plan.audio.duration,
      audioVolume: 1, fadeIn: 0, fadeOut: 0, speaker: '莫妮卡', ttsSource: 'imported', ttsProvider: 'import',
    };
    const subtitleNodes = plan.segments.map((segment, index) => ({
      id: crypto.randomUUID(), type: 'Subtitle', title: `字幕 ${index + 1}`, x: maxX + 450, y: minY + 260 + index * 150,
      prompt: segment.subtitle, subtitleText: segment.subtitle, status: 'success', model: '', aspectRatio: '9:16', resolution: 'Auto',
      parentIds: [], timelineStart: segment.start, timelineEnd: segment.end, speaker: '莫妮卡',
    }));
    const renderNode = {
      id: crypto.randomUUID(), type: 'Render', title: '莫妮卡自我介绍成片', x: maxX + 950, y: minY + 300,
      prompt: '', status: 'idle', model: '', aspectRatio: '9:16', resolution: '1080p', compWidth: 1080, compHeight: 1920,
      compFps: 24, endFadeToBlack: 0.6, parentIds: [...plan.shots.map((shot) => shot.nodeId), audioNode.id, ...subtitleNodes.map((node) => node.id)],
    };
    workflow.nodes.push(audioNode, ...subtitleNodes, renderNode);
    writeJson(workflowPath(workflow.id), workflow);

    plan.status = 'applied';
    plan.appliedWorkflowId = workflow.id;
    plan.renderNodeId = renderNode.id;
    plan.updatedAt = now;
    writeJson(planPath(plan.id), plan);
    return { plan, workflow, renderNodeId: renderNode.id };
  };

  const getRenderManifest = ({ workflowId, renderNodeId }) => {
    const workflow = readJson(workflowPath(workflowId), '工作流不存在');
    const manifest = buildManifestFromNodes(renderNodeId, workflow.nodes, { project: { id: workflow.id, title: workflow.title } });
    const validation = validateManifestShape(manifest);
    if (!validation.valid) throw new Error(`清单无效: ${validation.errors.join('; ')}`);
    return { manifest, duration: round(computeTotalDurationSec(manifest)) };
  };

  const updateRenderNode = ({ workflowId, renderNodeId, job }) => {
    const workflow = readJson(workflowPath(workflowId), '工作流不存在');
    const node = workflow.nodes.find((item) => item.id === renderNodeId && item.type === 'Render');
    if (!node) throw new Error('成片节点不存在');
    node.renderJobId = job.jobId;
    node.renderStatus = job.status;
    node.renderStage = job.stage;
    node.renderProgress = job.progress;
    node.renderOutputUrl = job.output || null;
    node.renderError = job.error || null;
    workflow.updatedAt = new Date().toISOString();
    writeJson(workflowPath(workflow.id), workflow);
    return { workflowId, renderNodeId, status: node.renderStatus, output: node.renderOutputUrl };
  };

  const syncRenderJob = (job) => {
    for (const item of listWorkflows()) {
      const workflow = readJson(workflowPath(item.id), '工作流不存在');
      const node = workflow.nodes?.find((candidate) => candidate.type === 'Render' && candidate.renderJobId === job.jobId);
      if (node) return updateRenderNode({ workflowId: workflow.id, renderNodeId: node.id, job });
    }
    return null;
  };

  const undoEditPlan = ({ planId, confirm = false }) => {
    if (!confirm) throw new Error('未确认：undo_edit_plan 必须传 confirm=true');
    const plan = readJson(planPath(planId), '剪辑计划不存在');
    if (!plan.appliedWorkflowId) return { removed: false, reason: '计划尚未应用' };
    const target = workflowPath(plan.appliedWorkflowId);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    plan.status = 'undone';
    plan.undoneAt = new Date().toISOString();
    writeJson(planPath(plan.id), plan);
    return { removed: true, workflowId: plan.appliedWorkflowId };
  };

  return { listWorkflows, readCanvas, analyzeDialogue, createEditPlan, applyEditPlan, getRenderManifest, updateRenderNode, syncRenderJob, undoEditPlan, probeDuration };
};
