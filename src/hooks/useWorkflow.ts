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

interface WorkflowData {
    id: string | null;
    title: string;
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
}

interface UseWorkflowOptions {
    nodes: NodeData[];
    groups: NodeGroup[];
    viewport: Viewport;
    canvasTitle: string;
    setNodes: Dispatch<SetStateAction<NodeData[]>>;
    setGroups: Dispatch<SetStateAction<NodeGroup[]>>; // For restoring groups when loading
    setViewport: Dispatch<SetStateAction<Viewport>>;
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setCanvasTitle: (title: string) => void;
    setEditingTitleValue: (value: string) => void;
    onPanelOpen?: () => void; // Called when workflow panel opens
}

export const useWorkflow = ({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setViewport,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    onPanelOpen
}: UseWorkflowOptions) => {
    // Workflow state
    const [workflowId, setWorkflowId] = useState<string | null>(null);
    const [isWorkflowPanelOpen, setIsWorkflowPanelOpen] = useState(false);
    const [workflowPanelY, setWorkflowPanelY] = useState(0);

    /**
     * Save current workflow to server
     */
    const handleSaveWorkflow = useCallback(async () => {
        try {
            const workflow: WorkflowData = {
                id: workflowId,
                title: canvasTitle,
                nodes,
                groups,
                viewport
            };

            const response = await fetch('http://localhost:3001/api/workflows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(workflow)
            });

            if (response.ok) {
                const result = await response.json();
                setWorkflowId(result.id);
                console.log('Workflow saved:', result.id);
            }
        } catch (error) {
            console.error('Failed to save workflow:', error);
        }
    }, [workflowId, canvasTitle, nodes, groups, viewport]);

    /**
     * Load workflow from server
     * Supports both user workflows and public workflows (prefixed with "public:")
     * Returns the loaded workflow's node count and title for tracking
     */
    const handleLoadWorkflow = useCallback(async (id: string): Promise<{ nodeCount: number; title: string } | null> => {
        try {
            // Check if loading a public workflow
            const isPublic = id.startsWith('public:');
            const workflowId = isPublic ? id.replace('public:', '') : id;
            const endpoint = isPublic
                ? `http://localhost:3001/api/public-workflows/${workflowId}`
                : `http://localhost:3001/api/workflows/${workflowId}`;

            const response = await fetch(endpoint);
            if (response.ok) {
                const workflow = await response.json();

                // For public workflows, don't set the workflowId so it saves as a new workflow
                if (!isPublic) {
                    setWorkflowId(workflow.id);
                } else {
                    setWorkflowId(null); // New copy, not linked to public workflow
                }

                setCanvasTitle(workflow.title || 'Untitled');
                setEditingTitleValue(workflow.title || 'Untitled');
                const loadedNodes: NodeData[] = workflow.nodes || [];
                setNodes(loadedNodes);
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
                    nodeCount: (workflow.nodes || []).length,
                    title: workflow.title || 'Untitled'
                };
            }
        } catch (error) {
            console.error('Failed to load workflow:', error);
        }
        return null;
    }, [setNodes, setGroups, setViewport, setSelectedNodeIds, setCanvasTitle, setEditingTitleValue]);

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
        setWorkflowId(null);
    }, []);

    return {
        workflowId,
        isWorkflowPanelOpen,
        workflowPanelY,
        handleSaveWorkflow,
        handleLoadWorkflow,
        handleWorkflowsClick,
        closeWorkflowPanel,
        resetWorkflowId
    };
};
