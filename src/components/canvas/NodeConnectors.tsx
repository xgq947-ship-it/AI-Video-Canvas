/**
 * NodeConnectors.tsx
 * 
 * Renders the left and right connector buttons for a node.
 * Handles pointer events for drag-to-connect functionality.
 */

import React from 'react';
import { Plus } from 'lucide-react';

interface NodeConnectorsProps {
    nodeId: string;
    onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => void;
    canvasTheme?: 'dark' | 'light';
    hideLeft?: boolean;
    inputPorts?: Array<{ id: string; label: string }>;
}

export const NodeConnectors: React.FC<NodeConnectorsProps> = ({
    nodeId,
    onConnectorDown,
    canvasTheme = 'dark',
    hideLeft = false,
    inputPorts = [],
}) => {
    const isDark = canvasTheme === 'dark';

    const buttonClassName = `absolute w-11 h-11 touch-none rounded-full border flex items-center justify-center transition-all opacity-0 group-hover/node:opacity-100 z-10 cursor-crosshair ${isDark
            ? 'border-neutral-700 bg-[#0f0f0f] text-neutral-400 hover:text-white hover:border-neutral-500'
            : 'border-neutral-300 bg-white text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 shadow-sm'
        }`;

    return (
        <>
            {/* Fixed input ports are used by Video Analysis. Each port carries
                its semantic role in the DOM so a drop never relies on the
                order of parentIds. */}
            {inputPorts.map((port, index) => (
                <button
                    key={port.id}
                    type="button"
                    aria-label={`连接到${port.label}`}
                    data-connector-node-id={nodeId}
                    data-connector-side="left"
                    data-input-port-id={port.id}
                    title={port.label}
                    onPointerDown={(e) => {
                        e.stopPropagation();
                        onConnectorDown(e, nodeId, 'left', port.id);
                    }}
                    className={`absolute -left-12 flex h-7 w-7 touch-none items-center justify-center rounded-full border text-[9px] opacity-100 transition-colors z-10 cursor-crosshair ${isDark
                        ? 'border-cyan-500/40 bg-[#0f0f0f] text-cyan-300 hover:border-cyan-300 hover:text-white'
                        : 'border-cyan-300 bg-white text-cyan-600 hover:border-cyan-500 hover:text-cyan-800 shadow-sm'
                        }`}
                    style={{ top: `${76 + index * 36}px` }}
                >
                    {index + 1}
                </button>
            ))}

            {!hideLeft && <>
            {/* Left Connector */}
            <button
                type="button"
                aria-label="连接到左侧"
                data-connector-node-id={nodeId}
                data-connector-side="left"
                onPointerDown={(e) => {
                    e.stopPropagation();
                    onConnectorDown(e, nodeId, 'left');
                }}
                className={`-left-12 top-1/2 -translate-y-1/2 ${buttonClassName}`}
            >
                <Plus size={18} />
            </button>
            </>}

            {/* Right Connector */}
            <button
                type="button"
                aria-label="连接到右侧"
                data-connector-node-id={nodeId}
                data-connector-side="right"
                onPointerDown={(e) => {
                    e.stopPropagation();
                    onConnectorDown(e, nodeId, 'right');
                }}
                className={`-right-12 top-1/2 -translate-y-1/2 ${buttonClassName}`}
            >
                <Plus size={18} />
            </button>
        </>
    );
};
