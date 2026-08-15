import { useCallback, useEffect, useRef } from 'react';
import { NodeData, NodeStatus, NodeType } from '../types';
import {
  getDetailRemixJob,
  getLatestDetailRemixJob,
  type DetailRemixJob,
} from '../services/detailRemixService';
import { createDetailRemixNodeData } from '../../shared/detailRemix.js';

export interface UseDetailRemixRecoveryOptions {
  nodes: NodeData[];
  workflowId?: string | null;
  updateNode: (id: string, updates: Partial<NodeData>) => void;
  /** Upsert every final result currently present in the durable job. */
  onResults?: (sourceNode: NodeData, job: DetailRemixJob) => void;
  pollIntervalMs?: number;
}

function normalizedStage(job: DetailRemixJob) {
  return String(job.stage || job.status || '').toLowerCase().replaceAll('-', '_');
}

function hasRenderableResults(job: DetailRemixJob) {
  return (job.pages || []).some(page => Boolean(
    page.finalUrl || page.resultUrl || page.compositeUrl || page.plateUrl,
  ));
}

function expectedResultIds(job: DetailRemixJob) {
  const dismissed = new Set(job.dismissedResultNodeIds || []);
  return (job.pages || []).map(page => {
    if ((page.finalUrl || page.resultUrl) && page.resultNodeId) return page.resultNodeId;
    if (page.compositeUrl && page.compositeNodeId) return page.compositeNodeId;
    if (page.plateUrl && page.plateNodeId) return page.plateNodeId;
    return undefined;
  }).filter((id): id is string => Boolean(id && !dismissed.has(id)));
}

function isPollingStage(job: DetailRemixJob) {
  const stage = normalizedStage(job);
  if (['plates_ready', 'plates_completed', 'plates_partial_failed', 'final_partial_failed', 'failed_validation', 'composition_completed', 'composition_partial_failed', 'composition_failed', 'completed', 'partial_failed', 'failed', 'cancelled', 'recovery_required'].includes(stage)) {
    return false;
  }
  return !['plates_ready', 'completed', 'partial_failed', 'failed', 'cancelled', 'recovery_required']
    .includes(String(job.status || '').toLowerCase().replaceAll('-', '_'));
}

function canvasWorkflowStatus(job: DetailRemixJob) {
  const stage = normalizedStage(job);
  if (stage === 'plates_ready' || stage === 'plates_completed') return 'plates-ready';
  if (stage === 'composing_products' || stage === 'composition_queued' || stage === 'rendering_copy') return 'composing';
  // A structural retry is a paid generation in flight, not analysis.
  if (stage === 'generating_final' || stage === 'regenerating_final') return 'generating-final';
  if (stage === 'generating_plates') return 'generating-plates';
  if (stage === 'completed' || stage === 'composition_completed') return 'completed';
  if (stage === 'cancelled') return 'cancelled';
  if (stage === 'failed' || stage === 'failed_validation' || stage === 'partial_failed' || stage === 'final_partial_failed' || stage === 'plates_partial_failed' || stage === 'composition_partial_failed' || stage === 'composition_failed' || stage === 'recovery_required') return 'error';
  if (stage.startsWith('analyzing') || stage === 'extracting_selling_points' || stage === 'planning' || stage === 'queued') return 'analyzing';
  return isPollingStage(job) ? 'analyzing' : 'ready';
}

function nodeStatusFor(job: DetailRemixJob) {
  const stage = normalizedStage(job);
  if (isPollingStage(job)) return NodeStatus.LOADING;
  if (stage === 'plates_ready' || stage === 'plates_completed' || stage === 'completed' || stage === 'composition_completed') return NodeStatus.SUCCESS;
  if (stage === 'final_partial_failed' && hasRenderableResults(job)) return NodeStatus.SUCCESS;
  if (stage === 'cancelled') return hasRenderableResults(job) ? NodeStatus.SUCCESS : NodeStatus.IDLE;
  return NodeStatus.ERROR;
}

function recognitionLabel(job: DetailRemixJob) {
  const provider = job.recognitionProvider || 'auto';
  return job.recognitionModel ? `${provider} · ${job.recognitionModel}` : String(provider);
}

function queueProgressFromJob(job: DetailRemixJob) {
  const chunks = job.ownRecognition?.chunks || [];
  const ownTotal = Number(job.ownRecognition?.totalImages) || job.ownDetails?.length || 0;
  const ownCompleted = Number(job.ownRecognition?.processedImages) || chunks
    .filter(chunk => chunk.status === 'completed')
    .reduce((total, chunk) => total + (Number(chunk.imageCount) || 0), 0);
  const ownFailed = chunks
    .filter(chunk => ['failed', 'recovery_required', 'cancelled'].includes(String(chunk.status)))
    .reduce((total, chunk) => total + (Number(chunk.imageCount) || 0), 0);
  const pages = job.pages || [];
  const competitorCompleted = pages.filter(page => page.status === 'completed').length;
  const competitorFailed = pages.filter(page => ['failed', 'failed_validation', 'recovery_required', 'cancelled'].includes(String(page.status))).length;
  const competitorFinished = pages.length > 0 && competitorCompleted + competitorFailed >= pages.length;
  const eligibleComposition = pages.filter(page => Boolean(page.rawPlateUrl || page.plateUrl));
  const compositionCompleted = eligibleComposition.filter(page => page.composeStatus === 'completed').length;
  const compositionFailed = eligibleComposition.filter(page => ['failed', 'recovery_required', 'cancelled'].includes(String(page.composeStatus))).length;
  const compositionFinished = eligibleComposition.length > 0
    && compositionCompleted + compositionFailed >= eligibleComposition.length;
  const running = ['pending', 'processing'].includes(String(job.status));
  return {
    ownKnowledge: {
      status: job.ownRecognition?.status === 'completed'
        ? 'completed'
        : job.ownRecognition?.status === 'processing' ? 'processing' : 'waiting',
      total: ownTotal,
      completed: Math.min(ownTotal, ownCompleted),
      failed: Math.min(ownTotal, ownFailed),
      sellingPointCount: job.ownRecognition?.sellingPointCount || job.ownSellingPoints?.length || 0,
    },
    competitor: {
      status: competitorFinished
        ? 'completed'
        : running && job.ownRecognition?.status === 'completed' && job.phase !== 'composition'
          ? 'processing'
          : 'waiting',
      total: job.pageCount || pages.length,
      completed: competitorCompleted,
      failed: competitorFailed,
      ...(Number.isInteger(job.currentPageIndex) ? { currentIndex: job.currentPageIndex } : {}),
    },
    composition: {
      status: compositionFinished
        ? 'completed'
        : running && job.phase === 'composition' ? 'processing' : 'waiting',
      total: eligibleComposition.length,
      completed: compositionCompleted,
      failed: compositionFailed,
      ...(Number.isInteger(job.currentCompositionIndex) ? { currentIndex: job.currentCompositionIndex } : {}),
    },
  };
}

/** Keep NodeData small while preserving the full durable analysis in the job. */
function detailStateFromJob(node: NodeData, job: DetailRemixJob) {
  const current = (node.detailRemix || {}) as unknown as Record<string, unknown>;
  const currentAnalysis = current.analysis && typeof current.analysis === 'object'
    ? current.analysis as Record<string, unknown>
    : {};
  return createDetailRemixNodeData({
    ...current,
    jobId: job.id,
    jobStatus: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    status: canvasWorkflowStatus(job),
    recognitionModel: recognitionLabel(job),
    productViewCount: job.ownRecognition?.productViewCount || job.productViews?.filter(view => view.imageUrl).length || 0,
    verifiedFactCount: job.ownRecognition?.verifiedFactCount || job.verifiedFacts?.length || 0,
    currentPageIndex: job.currentPageIndex,
    pageCount: job.pageCount || job.pages?.length || 0,
    version: job.version,
    queueProgress: queueProgressFromJob(job),
    analysis: {
      ...currentAnalysis,
      ...(Array.isArray(job.ownSellingPoints) ? { ownSellingPoints: job.ownSellingPoints } : {}),
      pages: job.pages || [],
    },
    lastJobUpdatedAt: job.updatedAt || job.createdAt || '',
    errorMessage: job.error,
  });
}

function jobSyncSignature(job: DetailRemixJob) {
  return JSON.stringify({
    updatedAt: job.updatedAt,
    status: job.status,
    stage: job.stage,
    results: (job.pages || []).map(page => [
      page.resultNodeId, page.finalUrl || page.resultUrl,
      page.plateNodeId, page.plateUrl,
      page.compositeNodeId, page.compositeUrl,
    ]),
    dismissed: job.dismissedResultNodeIds || [],
  });
}

export function useDetailRemixRecovery({
  nodes,
  workflowId,
  updateNode,
  onResults,
  pollIntervalMs = 1500,
}: UseDetailRemixRecoveryOptions) {
  const nodesRef = useRef(nodes);
  const resultSyncRef = useRef(new Map<string, string>());
  nodesRef.current = nodes;

  const applyJob = useCallback((node: NodeData, job: DetailRemixJob) => {
    if (hasRenderableResults(job)) {
      const signature = jobSyncSignature(job);
      if (resultSyncRef.current.get(job.id) !== signature) {
        resultSyncRef.current.set(job.id, signature);
        onResults?.(node, job);
      }
    }

    const current = (node.detailRemix || {}) as unknown as Record<string, unknown>;
    const updatedAt = job.updatedAt || job.createdAt || '';
    const alreadySynced = current.jobId === job.id
      && current.jobStatus === job.status
      && current.stage === job.stage
      && current.stageLabel === job.stageLabel
      && current.lastJobUpdatedAt === updatedAt
      && node.status === nodeStatusFor(job);
    if (alreadySynced) return;

    const running = isPollingStage(job);
    updateNode(node.id, {
      status: nodeStatusFor(job),
      detailRemix: detailStateFromJob(node, job) as NodeData['detailRemix'],
      errorMessage: job.error || undefined,
      generationStartTime: running ? (node.generationStartTime || Date.now()) : undefined,
    });
  }, [onResults, updateNode]);

  const checkJob = useCallback(async (nodeId: string, jobId: string) => {
    if (!workflowId) return;
    try {
      const job = await getDetailRemixJob(jobId, workflowId);
      const node = nodesRef.current.find(item => item.id === nodeId);
      const state = (node?.detailRemix || {}) as unknown as Record<string, unknown>;
      if (!node || state.jobId !== jobId) return;
      applyJob(node, job);
    } catch (error) {
      console.error(`[Detail Remix] Error checking job ${jobId}:`, error);
    }
  }, [applyJob, workflowId]);

  const reconcileLatest = useCallback(async (nodeId: string) => {
    if (!workflowId) return;
    try {
      const job = await getLatestDetailRemixJob(nodeId, workflowId);
      const node = nodesRef.current.find(item => item.id === nodeId);
      if (!job || !node) return;

      const expectedIds = expectedResultIds(job);
      const canvasIds = new Set(nodesRef.current.map(item => item.id));
      const allResultsPresent = expectedIds.length === 0 || expectedIds.every(id => canvasIds.has(id));
      if (!allResultsPresent && hasRenderableResults(job)) {
        resultSyncRef.current.delete(job.id);
      }
      applyJob(node, job);
    } catch (error) {
      console.error(`[Detail Remix] Error recovering latest job for node ${nodeId}:`, error);
    }
  }, [applyJob, workflowId]);

  const detailNodeIds = nodes
    .filter(node => node.type === NodeType.DETAIL_PAGE_REMIX)
    .map(node => node.id)
    .join(',');

  const pollingJobs = nodes.flatMap(node => {
    if (node.type !== NodeType.DETAIL_PAGE_REMIX) return [];
    const state = (node.detailRemix || {}) as unknown as Record<string, unknown>;
    const jobId = typeof state.jobId === 'string' ? state.jobId : '';
    const status = String(state.status || '').replaceAll('_', '-');
    if (!jobId || ['plates-ready', 'completed', 'error', 'cancelled'].includes(status)) return [];
    return [`${node.id}:${jobId}`];
  }).join(',');

  useEffect(() => {
    if (!detailNodeIds) return;
    detailNodeIds.split(',').forEach(nodeId => void reconcileLatest(nodeId));
  }, [detailNodeIds, reconcileLatest]);

  useEffect(() => {
    if (!pollingJobs) return;
    const pairs = pollingJobs.split(',').map(value => {
      const separator = value.indexOf(':');
      return { nodeId: value.slice(0, separator), jobId: value.slice(separator + 1) };
    });
    const checkAll = () => pairs.forEach(({ nodeId, jobId }) => void checkJob(nodeId, jobId));
    checkAll();
    const interval = window.setInterval(checkAll, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [checkJob, pollIntervalMs, pollingJobs]);
}
