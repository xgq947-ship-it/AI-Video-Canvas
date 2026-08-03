/**
 * useWorkflow.ts
 * 
 * Custom hook for managing workflow save/load functionality.
 * Handles persistence to the backend server.
 */

import React, { useState, useCallback, Dispatch, SetStateAction } from 'react';
import { NodeData, NodeGroup, Viewport } from '../types';
import { computeFitViewport } from '@/shared/canvasCoords.js';
import { ZOOM_MIN } from '@/shared/zoom.js';
import { getNodeHeight, getNodeWidth } from '../components/canvas/ConnectionsLayer';
import { getCanvasRect } from '../utils/canvasRect';
import {
    mergeServerNormalizedNodes,
    mergeServerNormalizedVideoRemixes,
} from '../utils/workflowSave.js';
import {
    migrateLegacyVideoRemixNodes,
    normalizeVideoRemixProjects,
    type VideoRemixProject,
} from '@/shared/videoRemixProjects.js';

interface WorkflowData {
    id: string | null;
    title: string;
    projectDirName?: string;
    projectPath?: string;
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    videoRemixes: VideoRemixProject[];
}

interface UseWorkflowOptions {
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    canvasTitle: string;
    videoRemixes: VideoRemixProject[];
    setNodes: Dispatch<SetStateAction<NodeData[]>>;
    setGroups: Dispatch<SetStateAction<NodeGroup[]>>; // For restoring groups when loading
    setViewport: Dispatch<SetStateAction<Viewport>>;
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setCanvasTitle: (title: string) => void;
    setEditingTitleValue: (value: string) => void;
    setVideoRemixes: Dispatch<SetStateAction<VideoRemixProject[]>>;
    onPanelOpen?: () => void; // Called when workflow panel opens
    // Set right before applying the server's sanitized nodes back into state,
    // so that write-back doesn't get treated as a user edit (dirty flag / re-save loop)
    ignoreNextChangeRef?: React.MutableRefObject<boolean>;
}

export const useWorkflow = ({
    nodes,
    groups,
    viewport,
    canvasTitle,
    videoRemixes,
    setNodes,
    setGroups,
    setViewport,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    setVideoRemixes,
    onPanelOpen,
    ignoreNextChangeRef
}: UseWorkflowOptions) => {
    // Workflow state
    const [workflowId, setWorkflowId] = useState<string | null>(null);
    const [projectDirName, setProjectDirName] = useState<string | null>(null);
    const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
    const [workflowPanelY, setWorkflowPanelY] = useState(0);
    const workflowIdRef = React.useRef<string | null>(workflowId);
    const latestWorkflowRef = React.useRef({ nodes, groups, viewport, canvasTitle, videoRemixes });
    const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
    workflowIdRef.current = workflowId;
    latestWorkflowRef.current = { nodes, groups, viewport, canvasTitle, videoRemixes };

    /**
     * Save current workflow to server
     */
    const handleSaveWorkflow = useCallback(() => {
        // Freeze the canvas snapshot at the moment the user/auto-save requested
        // the save. Requests themselves are serialized so an older request can
        // never finish writing after a newer one.
        const snapshot = latestWorkflowRef.current;
        const save = saveQueueRef.current.catch(() => undefined).then(async () => {
            const workflow: WorkflowData = {
                id: workflowIdRef.current,
                title: snapshot.canvasTitle,
                nodes: snapshot.nodes,
                groups: snapshot.groups,
                viewport: snapshot.viewport,
                videoRemixes: snapshot.videoRemixes,
            };

            try {
                const response = await fetch('/api/workflows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(workflow)
                });

                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.error || '项目保存失败');
                }
                workflowIdRef.current = result.id;
                setWorkflowId(result.id);
                if (result.projectDirName) setProjectDirName(result.projectDirName);
                console.log('Workflow saved:', result.id);

                // The server may normalize base64 or cross-project media URLs. Merge
                // only those URL changes into the latest state; never replace nodes,
                // statuses or generation results with this request's old snapshot.
                if (Array.isArray(result.nodes)) {
                    if (ignoreNextChangeRef) ignoreNextChangeRef.current = true;
                    setNodes(currentNodes => mergeServerNormalizedNodes(
                        currentNodes,
                        snapshot.nodes,
                        result.nodes
                    ));
                }
                if (Array.isArray(result.videoRemixes)) {
                    if (ignoreNextChangeRef) ignoreNextChangeRef.current = true;
                    setVideoRemixes(current => mergeServerNormalizedVideoRemixes(
                        current,
                        snapshot.videoRemixes,
                        normalizeVideoRemixProjects(result.videoRemixes)
                    ));
                }
            } catch (error) {
                console.error('Failed to save workflow:', error);
                throw error;
            }
        });
        saveQueueRef.current = save;
        return save;
    }, [setNodes, setVideoRemixes, ignoreNextChangeRef]);

    /**
     * Load workflow from server
     * Supports both user workflows and public workflows (prefixed with "public:")
     * Returns the loaded workflow's node count and title for tracking
     */
    const handleLoadWorkflow = useCallback(async (id: string): Promise<{
        nodeCount: number;
        title: string;
        migratedVideoRemixes: boolean;
    } | null> => {
        try {
            // Check if loading a public workflow
            const isPublic = id.startsWith('public:');
            const workflowId = isPublic ? id.replace('public:', '') : id;
            const endpoint = isPublic
                ? `/api/public-workflows/${workflowId}`
                : `/api/workflows/${workflowId}`;

            const response = await fetch(endpoint);
            if (response.ok) {
                const workflow = await response.json();

                // For public workflows, don't set the workflowId so it saves as a new workflow
                if (!isPublic) {
                    workflowIdRef.current = workflow.id;
                    setWorkflowId(workflow.id);
                    setProjectDirName(workflow.projectDirName || null);
                } else {
                    workflowIdRef.current = null;
                    setWorkflowId(null); // New copy, not linked to public workflow
                    setProjectDirName(null);
                }

                setCanvasTitle(workflow.title || 'Untitled');
                setEditingTitleValue(workflow.title || 'Untitled');
                const migrated = migrateLegacyVideoRemixNodes(
                    workflow.nodes || [],
                    normalizeVideoRemixProjects(workflow.videoRemixes || [])
                );
                const loadedNodes: NodeData[] = migrated.nodes;
                setNodes(loadedNodes);
                setVideoRemixes(migrated.videoRemixes);
                setGroups(workflow.groups || []); // Restore groups
                if (loadedNodes.length > 0) {
                    const bounds = loadedNodes.map(node => {
                        const parent = node.parentIds?.length
                            ? loadedNodes.find(item => item.id === node.parentIds?.[0])
                            : undefined;
                        return {
                            x: node.x,
                            y: node.y,
                            width: getNodeWidth(node, parent),
                            height: getNodeHeight(node, parent),
                        };
                    });
                    const minX = Math.min(...bounds.map(item => item.x));
                    const minY = Math.min(...bounds.map(item => item.y));
                    const maxX = Math.max(...bounds.map(item => item.x + item.width));
                    const maxY = Math.max(...bounds.map(item => item.y + item.height));
                    setViewport(computeFitViewport(getCanvasRect(), {
                        x: minX,
                        y: minY,
                        width: maxX - minX,
                        height: maxY - minY,
                    }, { minZoom: ZOOM_MIN, maxZoom: 1, padding: 0.82 }));
                } else {
                    setViewport({ x: 0, y: 0, zoom: 1 });
                }
                // Reset selection
                setSelectedNodeIds([]);
                setIsWorkflowPanelOpen(false);
                console.log(isPublic ? 'Public workflow loaded:' : 'Workflow loaded:', workflowId);
                // Return info for tracking
                return {
                    nodeCount: loadedNodes.length,
                    title: workflow.title || 'Untitled',
                    migratedVideoRemixes: migrated.migrated,
                };
            }
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
        return null;
    }, [
        setNodes,
        setGroups,
        setViewport,
        setSelectedNodeIds,
        setCanvasTitle,
        setEditingTitleValue,
        setVideoRemixes,
    ]);

    /**
     * Handle workflow panel toggle from toolbar click
     */
    const handleWorkflowsClick = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setWorkflowPanelY(rect.top);
        setIsWorkflowPanelOpen(prev => !prev);
        onPanelOpen?.(); // Close other panels
    }, [onPanelOpen]);

    /**
     * Close workflow panel
     */
    const closeWorkflowPanel = useCallback(() => {
        setIsWorkflowPanelOpen(false);
    }, []);

    /**
     * Reset workflow ID (for creating a new canvas)
     */
    const resetWorkflowId = useCallback(() => {
        workflowIdRef.current = null;
        setWorkflowId(null);
        setProjectDirName(null);
    }, []);

    const handleCreateWorkflow = useCallback(async (title: string, locationId?: string | null) => {
        if (locationId) {
            if (!window.evanDesktop?.createProject) {
                throw new Error('自定义项目路径仅在 Evan 桌面应用中可用');
            }
            const data = await window.evanDesktop.createProject({ title, locationId });
            workflowIdRef.current = data.id;
            setWorkflowId(data.id);
            setProjectDirName(data.projectDirName || null);
            return data as WorkflowData;
        }

        const response = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '项目创建失败');
        workflowIdRef.current = data.id;
        setWorkflowId(data.id);
        setProjectDirName(data.projectDirName || null);
        return data as WorkflowData;
    }, []);

    return {
        workflowId,
        projectDirName,
        isWorkflowPanelOpen,
        workflowPanelY,
        handleSaveWorkflow,
        handleLoadWorkflow,
        handleWorkflowsClick,
        closeWorkflowPanel,
        resetWorkflowId,
        handleCreateWorkflow
    };
};
