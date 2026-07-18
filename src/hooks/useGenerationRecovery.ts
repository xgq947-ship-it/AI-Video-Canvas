/**
 * useGenerationRecovery.ts
 * 
 * Custom hook that checks for nodes in 'loading' status and polls
 * the backend to see if their generation has finished.
 */

import { useEffect, useCallback, useRef } from 'react';
import { NodeData, NodeStatus } from '../types';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { getCodexImageJob } from '../services/generationService';
import { isGenerationRecoveryExpired } from '../utils/generationRecovery.js';

interface UseGenerationRecoveryOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGenerationRecovery = ({
    nodes,
    updateNode
}: UseGenerationRecoveryOptions) => {
    // Use a ref to access current nodes without causing re-renders
    const nodesRef = useRef<NodeData[]>(nodes);
    nodesRef.current = nodes;

    const checkStatus = useCallback(async (nodeId: string) => {
        try {
            const currentNode = nodesRef.current.find(n => n.id === nodeId);
            if (currentNode && isGenerationRecoveryExpired(currentNode)) {
                updateNode(nodeId, {
                    status: currentNode.resultUrl ? NodeStatus.SUCCESS : NodeStatus.ERROR,
                    errorMessage: '生成任务已中断或超时，请重新生成。',
                    generationStartTime: undefined
                });
                return;
            }

            const response = await fetch(`/api/generation-status/${nodeId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success' && data.resultUrl) {
                    // Access nodes via ref to avoid stale closure
                    const node = nodesRef.current.find(n => n.id === nodeId);

                    // Race condition check: If node has a generationStartTime, compare with result's createdAt
                    // This prevents applying stale results from previous generations
                    if (node?.generationStartTime && data.createdAt) {
                        const resultCreatedAt = new Date(data.createdAt).getTime();
                        if (resultCreatedAt < node.generationStartTime) {
                            // Stale result, skip silently (don't spam console)
                            return;
                        }
                    }

                    console.log(`[Recovery] Found new result for node ${nodeId}`);

                    // Update node with success status and result URL
                    const updates: Partial<NodeData> = {
                        status: NodeStatus.SUCCESS,
                        resultUrl: data.resultUrl,
                        errorMessage: undefined,
                        generationStartTime: undefined // Clear the timestamp after successful recovery
                    };

                    // If it's a video, extract the last frame for chaining
                    if (data.type === 'video') {
                        try {
                            const lastFrame = await extractVideoLastFrame(data.resultUrl);
                            updates.lastFrame = lastFrame;
                        } catch (err) {
                            console.error(`[Recovery] Failed to extract last frame for node ${nodeId}:`, err);
                        }
                    }

                    updateNode(nodeId, updates);
                }
            }
        } catch (error) {
            console.error(`[Recovery] Error checking status for node ${nodeId}:`, error);
        }
    }, [updateNode]); // Only updateNode as dependency, nodes accessed via ref

    const checkCodexStatus = useCallback(async (nodeId: string, jobId: string) => {
        try {
            const job = await getCodexImageJob(jobId);
            const node = nodesRef.current.find(n => n.id === nodeId);

            // A newer regeneration request owns this node now. Keep the old result as history only.
            if (!node || node.codexJobId !== jobId) return;

            if (job.status === 'pending' || job.status === 'processing') {
                if (node.codexJobStatus !== job.status) {
                    updateNode(nodeId, { codexJobStatus: job.status });
                }
                return;
            }

            if (job.status === 'failed') {
                updateNode(nodeId, {
                    status: node.resultUrl ? NodeStatus.SUCCESS : NodeStatus.ERROR,
                    codexJobStatus: 'failed',
                    errorMessage: job.error || 'Codex image generation failed',
                    generationStartTime: undefined
                });
                return;
            }

            if (job.status === 'completed' && job.resultUrl) {
                const resultUrl = `${job.resultUrl}?t=${Date.now()}`;
                const existingVersions = node.imageVersions || [];
                const imageVersions = existingVersions.some(version => version.jobId === job.id)
                    ? existingVersions
                    : [...existingVersions, {
                        jobId: job.id,
                        url: resultUrl,
                        prompt: job.prompt,
                        attempt: job.attempt,
                        createdAt: job.completedAt || new Date().toISOString()
                    }];

                updateNode(nodeId, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio: job.outputDimensions
                        ? `${job.outputDimensions.width}/${job.outputDimensions.height}`
                        : node.resultAspectRatio,
                    codexJobStatus: 'completed',
                    imageVersions,
                    errorMessage: undefined,
                    generationStartTime: undefined
                });
            }
        } catch (error) {
            console.error(`[Codex Image] Error checking job ${jobId}:`, error);
        }
    }, [updateNode]);

    // Track loading node IDs for stable dependency
    const loadingNodeIds = nodes
        .filter(n => n.status === NodeStatus.LOADING && !n.codexJobId)
        .map(n => n.id)
        .join(',');

    const codexLoadingJobs = nodes
        .filter(n => n.status === NodeStatus.LOADING && n.codexJobId)
        .map(n => `${n.id}:${n.codexJobId}`)
        .join(',');

    useEffect(() => {
        if (!loadingNodeIds) return;

        const nodeIds = loadingNodeIds.split(',');

        // Check each loading node every 10 seconds
        const checkAll = () => {
            nodeIds.forEach(nodeId => checkStatus(nodeId));
        };

        checkAll(); // Initial check

        const interval = setInterval(checkAll, 10000); // Check every 10s

        return () => clearInterval(interval);
    }, [loadingNodeIds, checkStatus]); // Stable string dependency instead of nodes array

    useEffect(() => {
        if (!codexLoadingJobs) return;

        const jobs = codexLoadingJobs.split(',').map(value => {
            const separator = value.indexOf(':');
            return { nodeId: value.slice(0, separator), jobId: value.slice(separator + 1) };
        });
        const checkAll = () => jobs.forEach(job => checkCodexStatus(job.nodeId, job.jobId));

        checkAll();
        const interval = setInterval(checkAll, 1500);
        return () => clearInterval(interval);
    }, [codexLoadingJobs, checkCodexStatus]);
};
