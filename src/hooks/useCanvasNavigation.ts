/**
 * useCanvasNavigation.ts
 * 
 * Custom hook for managing canvas viewport, zoom, and pan functionality.
 * Handles mouse wheel zoom, slider zoom, and viewport transformations.
 */

import React, { useState, useRef } from 'react';
import { Viewport, NodeData, NodeType } from '../types';
import { clampZoom, zoomFactorFromWheel } from '@/shared/zoom.js';

export const useCanvasNavigation = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
    const canvasRef = useRef<HTMLDivElement>(null);

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Handles mouse wheel events for zooming and panning
     * Ctrl/Cmd + Wheel: Zoom in/out
     * Wheel: Pan canvas
     */
    const handleWheel = (e: React.WheelEvent, hoveredNode?: NodeData) => {
        if (e.ctrlKey || e.metaKey) {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            // 缩放倍率按设备类型区分灵敏度（触控板 delta 小而密集，鼠标滚轮大而离散）
            const step = zoomFactorFromWheel(e.deltaY, e.deltaMode);
            // 事件字段必须在进入更新函数前取出：更新函数是异步执行的，
            // 那时合成事件的字段可能已经被回收。
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            /**
             * 全程基于 prev 计算，不能读闭包里的 viewport。
             *
             * 触控板捏合一次会连发几十个 wheel 事件，它们在同一个任务里被批处理，
             * 期间组件不会重渲染。若从闭包取 viewport，这一串事件会全部基于同一个
             * 陈旧值：缩放倍率被吞掉（结果是 base×step 而不是 base×step^n，手感
             * 明显发滞），锚点也按错误的基准换算，于是反复缩放后位置越飘越远。
             */
            setViewport(prev => {
                let targetZoom = prev.zoom * step;

                // 悬停在节点上时限制单个节点的最大占屏比例
                if (hoveredNode) {
                    const nodeWidth = 600;
                    const nodeHeight = 700;
                    const maxZWidth = (window.innerWidth * 0.9) / nodeWidth;
                    const maxZHeight = (window.innerHeight * 0.9) / nodeHeight;
                    targetZoom = Math.min(targetZoom, Math.min(maxZWidth, maxZHeight));
                }

                const newZoom = clampZoom(targetZoom);
                // 夹紧后倍率没变（已到上下限）就不要再动画布位置，
                // 否则在边界继续滚会让画面持续漂移。
                if (newZoom === prev.zoom) return prev;

                let anchorX = mouseX;
                let anchorY = mouseY;

                if (hoveredNode) {
                    const isVideo = hoveredNode.type === NodeType.VIDEO;
                    const nodeWidth = isVideo ? 385 : 365;
                    const nodeHeight = 400;
                    const nodeCenterX = hoveredNode.x + nodeWidth / 2;
                    const nodeCenterY = hoveredNode.y + nodeHeight / 2;
                    anchorX = nodeCenterX * prev.zoom + prev.x;
                    anchorY = nodeCenterY * prev.zoom + prev.y;
                }

                let newX = anchorX - (anchorX - prev.x) * (newZoom / prev.zoom);
                let newY = anchorY - (anchorY - prev.y) * (newZoom / prev.zoom);

                if (hoveredNode && newZoom > prev.zoom) {
                    const strength = 0.1;
                    newX += (window.innerWidth / 2 - anchorX) * strength;
                    newY += (window.innerHeight / 2 - anchorY) * strength;
                }

                return { x: newX, y: newY, zoom: newZoom };
            });
        } else {
            // Pan with regular wheel
            const { deltaX, deltaY } = e;
            setViewport(prev => ({
                ...prev,
                x: prev.x - deltaX,
                y: prev.y - deltaY
            }));
        }
    };

    /**
     * Handles zoom slider changes
     * Zooms from center of viewport
     */
    const handleSliderZoom = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newZoom = parseFloat(e.target.value);
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;

        // 与滚轮缩放同理：拖动滑块同样会连发 change 事件，必须基于 prev 换算。
        setViewport(prev => ({
            x: cx - (cx - prev.x) * (newZoom / prev.zoom),
            y: cy - (cy - prev.y) * (newZoom / prev.zoom),
            zoom: newZoom
        }));
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        viewport,
        setViewport,
        canvasRef,
        handleWheel,
        handleSliderZoom
    };
};
