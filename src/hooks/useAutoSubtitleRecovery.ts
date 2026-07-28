import { useEffect, useRef } from 'react';
import { NodeData, NodeStatus, NodeType } from '../types';

interface Options {
  nodes: NodeData[];
  updateNode: (id: string, updates: Partial<NodeData>) => void;
  onCompleted?: () => void;
  onFailed?: (message: string) => void;
}

const ACTIVE = new Set(['queued', 'extracting', 'transcribing', 'rendering']);

/** 轮询自动字幕任务；输出完成后把占位节点转换成普通、可继续使用的视频节点。 */
export const useAutoSubtitleRecovery = ({ nodes, updateNode, onCompleted, onFailed }: Options) => {
  const nodesRef = useRef(nodes);
  const missingRef = useRef(new Map<string, number>());
  const notifiedRef = useRef(new Set<string>());
  nodesRef.current = nodes;

  useEffect(() => {
    const pending = nodes.filter(node =>
      node.type === NodeType.VIDEO &&
      node.subtitleJobId &&
      node.status === NodeStatus.LOADING &&
      ACTIVE.has(node.subtitleJobStatus || 'queued')
    );
    if (pending.length === 0) return;
    let alive = true;

    const pollNode = async (snapshot: NodeData) => {
      const jobId = snapshot.subtitleJobId!;
      try {
        const response = await fetch(`/api/auto-subtitles/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        if (!alive) return;
        const current = nodesRef.current.find(node => node.id === snapshot.id && node.subtitleJobId === jobId);
        if (!current) return;
        if (response.status === 404) {
          const misses = (missingRef.current.get(jobId) || 0) + 1;
          missingRef.current.set(jobId, misses);
          if (misses >= 3) {
            const message = '自动字幕任务已中断，请重新点击源视频的“自动字幕”';
            updateNode(snapshot.id, {
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
          updateNode(snapshot.id, {
            status: NodeStatus.SUCCESS,
            resultUrl: `${job.output}${job.output.includes('?') ? '&' : '?'}t=${Date.now()}`,
            resultAspectRatio: job.resultAspectRatio,
            videoDuration: job.durationSec,
            subtitleJobStatus: 'success',
            subtitleJobStage: 'done',
            subtitleJobProgress: 1,
            subtitleSegments: job.subtitles || [],
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
          updateNode(snapshot.id, {
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
        updateNode(snapshot.id, {
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
  }, [nodes, updateNode, onCompleted, onFailed]);
};
