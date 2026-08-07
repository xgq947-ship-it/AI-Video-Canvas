import { useEffect, useRef } from 'react';
import { NodeData, NodeStatus, NodeType } from '../types';

interface Options {
  nodes: NodeData[];
  updateNode: (id: string, updates: Partial<NodeData>) => void;
  onCompleted?: () => void;
  onFailed?: (message: string) => void;
}

const ACTIVE = new Set(['queued', 'extracting', 'transcribing', 'aligning', 'punctuating', 'rendering']);

/**
 * 把"当前有哪些字幕任务在跑"压成一个稳定字符串。
 *
 * effect 绝对不能直接依赖 `nodes`：effect 体里是
 * `setInterval(tick, 1200)` 紧跟一次同步 `tick()`，而 `nodes` 在拖拽期间每帧
 * 都是新数组。一旦把它放进依赖数组，拖动任意节点都会重建定时器并立刻多发一轮
 * 请求 —— 60fps 拖拽就是每秒 60 次轮询，而不是设计中的 0.83 次。
 *
 * 这里只把真正决定"该不该轮询、轮询谁"的字段拼进 key，节点坐标变化不会影响它。
 * 同样的做法见 useGenerationRecovery.ts。
 */
const pendingJobsKey = (nodes: NodeData[]) => nodes
  .filter(node =>
    node.type === NodeType.VIDEO &&
    node.subtitleJobId &&
    node.status === NodeStatus.LOADING &&
    ACTIVE.has(node.subtitleJobStatus || 'queued')
  )
  .map(node => `${node.id}:${node.subtitleJobId}`)
  .join(',');

/** 轮询自动字幕任务；输出完成后把占位节点转换成普通、可继续使用的视频节点。 */
export const useAutoSubtitleRecovery = ({ nodes, updateNode, onCompleted, onFailed }: Options) => {
  const nodesRef = useRef(nodes);
  const missingRef = useRef(new Map<string, number>());
  const notifiedRef = useRef(new Set<string>());
  nodesRef.current = nodes;

  // 回调同样不进依赖数组：调用方是否记忆化不该影响轮询节奏。
  const callbacksRef = useRef({ updateNode, onCompleted, onFailed });
  callbacksRef.current = { updateNode, onCompleted, onFailed };

  const pendingJobs = pendingJobsKey(nodes);

  useEffect(() => {
    if (!pendingJobs) return;
    const pending = pendingJobs.split(',').map(entry => {
      const separator = entry.indexOf(':');
      return { id: entry.slice(0, separator), jobId: entry.slice(separator + 1) };
    });
    let alive = true;

    const pollNode = async ({ id: nodeId, jobId }: { id: string; jobId: string }) => {
      const { updateNode, onCompleted, onFailed } = callbacksRef.current;
      try {
        const response = await fetch(`/api/auto-subtitles/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (!alive) return;
        const current = nodesRef.current.find(node => node.id === nodeId && node.subtitleJobId === jobId);
        if (!current) return;
        if (response.status === 404) {
          const misses = (missingRef.current.get(jobId) || 0) + 1;
          missingRef.current.set(jobId, misses);
          if (misses >= 3) {
            const message = '自动字幕任务已中断，请重新点击源视频的“自动字幕”';
            updateNode(nodeId, {
              status: NodeStatus.ERROR,
              subtitleJobStatus: 'failed',
              errorMessage: message,
            });
            if (!notifiedRef.current.has(jobId)) {
              notifiedRef.current.add(jobId);
              onFailed?.(message);
            }
          }
          return;
        }
        const job = await response.json();
        if (!response.ok) throw new Error(job.error || '自动字幕任务查询失败');
        missingRef.current.delete(jobId);
        if (job.status === 'success' && job.output) {
          updateNode(nodeId, {
            status: NodeStatus.SUCCESS,
            resultUrl: `${job.output}${job.output.includes('?') ? '&' : '?'}t=${Date.now()}`,
            resultAspectRatio: job.resultAspectRatio,
            videoDuration: job.durationSec,
            subtitleJobStatus: 'success',
            subtitleJobStage: 'done',
            subtitleJobProgress: 1,
            subtitleAlignmentQuality: job.alignmentQuality,
            subtitleTranscriptionEngine: job.transcriptionEngine,
            subtitleFormat: job.subtitleFormat,
            subtitleSegments: job.subtitles || [],
            model: job.alignmentQuality === 'word' ? '精准字幕 · 词级对齐' : '自动字幕 · 段落估时',
            videoModel: job.alignmentQuality === 'word' ? '精准字幕 · 词级对齐' : '自动字幕 · 段落估时',
            prompt: (job.subtitles || []).map((segment: { text: string }) => segment.text).join(''),
            errorMessage: undefined,
          });
          if (!notifiedRef.current.has(jobId)) {
            notifiedRef.current.add(jobId);
            onCompleted?.();
          }
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          const message = job.error || (job.status === 'cancelled' ? '自动字幕任务已取消' : '自动字幕生成失败');
          updateNode(nodeId, {
            status: NodeStatus.ERROR,
            subtitleJobStatus: job.status,
            subtitleJobStage: job.stage,
            subtitleJobProgress: job.progress,
            errorMessage: message,
          });
          if (!notifiedRef.current.has(jobId)) {
            notifiedRef.current.add(jobId);
            onFailed?.(message);
          }
          return;
        }
        updateNode(nodeId, {
          subtitleJobStatus: job.status,
          subtitleJobStage: job.stage,
          subtitleJobProgress: job.progress,
        });
      } catch (error) {
        console.error(`[AutoSubtitle] poll ${jobId} failed`, error);
      }
    };

    const tick = () => void Promise.all(pending.map(pollNode));
    const timer = window.setInterval(tick, 1200);
    tick();
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pendingJobs]);
};
