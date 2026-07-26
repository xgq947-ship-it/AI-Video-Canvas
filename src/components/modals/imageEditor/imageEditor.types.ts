/**
 * imageEditor.types.ts
 * 
 * Shared types and constants for the Image Editor modal.
 */
import { IMAGE_GENERATION_PROVIDERS } from '../../../../shared/generationProviders.js';

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
    provider: string;
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
export const IMAGE_MODELS: ImageModel[] = IMAGE_GENERATION_PROVIDERS.map(model => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    supportsImageToImage: model.supportsImageToImage,
    supportsMultiImage: model.supportsMultipleReferenceImages,
    resolutions: [...model.resolutions],
    aspectRatios: [...model.supportedAspectRatios],
}));

/**
 * Preset brush colors
 */
export const PRESET_COLORS = ['#ff0000', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
