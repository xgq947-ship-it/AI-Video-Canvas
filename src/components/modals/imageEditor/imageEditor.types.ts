/**
 * imageEditor.types.ts
 * 
 * Shared types and constants for the Image Editor modal.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arrow element for annotations
 */
export interface ArrowElement {
    id: string;
    type: 'arrow';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    lineWidth: number;
}

/**
 * Text element for annotations
 */
export interface TextElement {
    id: string;
    type: 'text';
    x: number;
    y: number;
    text: string;
    fontSize: number;
    color: string;
    fontFamily: string;
}

/**
 * Union type for all drawable elements
 */
export type EditorElement = ArrowElement | TextElement;

/**
 * Snapshot of editor state for undo/redo
 */
export interface HistoryState {
    canvasData: string | Blob | null; // Binary in memory; string retained for backward compatibility
    elements: EditorElement[];
    imageUrl?: string; // Current image URL (for crop undo/redo)
}

export interface ImageGenerationSettings {
    imageModel: string;
    aspectRatio: string;
    resolution: string;
}

/**
 * Props for the main ImageEditorModal component
 */
export interface ImageEditorModalProps {
    isOpen: boolean;
    nodeId: string;
    imageUrl?: string;
    initialPrompt?: string;
    initialModel?: string;
    initialAspectRatio?: string;
    initialResolution?: string;
    initialGenerationCount?: number;
    initialElements?: EditorElement[];
    initialCanvasData?: string;
    initialCanvasSize?: { width: number; height: number };
    initialBackgroundUrl?: string; // Original/clean image for editing
    onClose: () => void;
    onGenerate: (
        id: string,
        prompt: string,
        count: number,
        settings: ImageGenerationSettings
    ) => void;
    onUpdate: (id: string, updates: any) => void;
}

/**
 * Image model configuration
 */
export interface ImageModel {
    id: string;
    name: string;
    provider: 'codex' | 'workflow' | 'kling';
    supportsImageToImage: boolean;
    supportsMultiImage: boolean;
    resolutions: string[];
    aspectRatios: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Available image generation models
 * Browser workflow models support reference images through Google Flow or 即梦.
 */
export const IMAGE_MODELS: ImageModel[] = [
    { id: 'codex-imagegen', name: 'Codex 生图', provider: 'codex', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["Auto"], aspectRatios: ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"] },
    { id: 'google-flow-nano-banana-pro', name: 'Google Flow · Nano Banana Pro', provider: 'workflow', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["自动"], aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"] },
    { id: 'google-flow-nano-banana-2', name: 'Google Flow · Nano Banana 2', provider: 'workflow', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["自动"], aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"] },
    { id: 'google-flow-nano-banana-2-lite', name: 'Google Flow · Nano Banana 2 Lite', provider: 'workflow', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["自动"], aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"] },
    { id: 'jimeng-image-5-0-pro', name: '即梦 · 图片 5.0 Pro', provider: 'workflow', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["2K", "4K"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] },
    { id: 'jimeng-image-5-0-lite', name: '即梦 · 图片 5.0 Lite', provider: 'workflow', supportsImageToImage: true, supportsMultiImage: true, resolutions: ["2K", "4K"], aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] },
];

/**
 * Preset brush colors
 */
export const PRESET_COLORS = ['#ff0000', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
