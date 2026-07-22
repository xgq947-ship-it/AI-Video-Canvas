/**
 * NodeControls.tsx
 * 
 * Control panel for canvas nodes.
 * Handles prompt input, model selection, size/ratio settings, and generation button.
 * For Video nodes: includes Advanced Settings for frame-to-frame mode.
 */

import React, { useState, useRef, useEffect, memo } from 'react';
import { Sparkles, Banana, Settings2, Check, ChevronDown, ChevronUp, GripVertical, Image as ImageIcon, Film, Clock, Expand, Shrink, Monitor, Crop, HardDrive, Upload, Loader2, Mic2, ScanSearch } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { useBrowserModels } from '../../hooks/useBrowserModels';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import type { NodeReference } from '../../utils/nodeReferences.js';
import { extractReferenceLabels } from '../../utils/nodeReferences.js';
import {
    IMAGE_PROMPT_OPTIMIZATION_PROFILES,
    VIDEO_PROMPT_OPTIMIZATION_PROFILES,
    resolveVideoProfileForModel,
    PROMPT_OPTIMIZATION_PROFILES,
    type PromptOptimizationProfile
} from '../../../shared/promptOptimizationProfiles.js';
import { shouldUseReferenceImages, usesReferenceMaterialsOnly } from '../../utils/videoModelCapabilities.js';
import { buildReverseImagePromptInstruction, type ReverseImagePromptMode } from '../../../shared/reverseImagePrompt.js';

interface NodeControlsProps {
    workflowId?: string;
    data: NodeData;
    inputUrl?: string;
    isLoading: boolean;
    isSuccess: boolean;
    connectedReferences?: NodeReference[];
    onUpdate: (id: string, updates: Partial<NodeData>) => void;
    onGenerate: (id: string) => void;
    onChangeAngleGenerate?: (nodeId: string) => void;
    onSelect: (id: string) => void;
    zoom: number;
    canvasTheme?: 'dark' | 'light';
}

const IMAGE_RATIOS = [
    "Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"
];

const VIDEO_RESOLUTIONS = [
    "Auto", "1080p", "768p", "720p", "512p"
];

// Video durations in seconds
const VIDEO_DURATIONS = [5, 6, 8, 10];

// Video model versions with metadata
// supportsTextToVideo: Can generate video from text prompt only
// supportsImageToVideo: Can use a single input image (start frame)
// supportsMultiImage: Can use multiple input images (frame-to-frame)
// durations: Supported video durations in seconds.
//   **空数组 = 该模型不提供时长选择**（时长由模型自己固定），此时界面不显示时长控件。
//   例如 Google Flow 的 Veo 3.1 - Lite，其设置菜单里根本没有时长 tab。
// resolutions: Supported resolutions (model-specific)
// aspectRatios: Supported aspect ratios (most video models support 16:9 and 9:16)
const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"];

interface VideoModelOption {
    id: string;
    name: string;
    provider: 'google' | 'workflow' | 'seedance';
    supportsTextToVideo: boolean;
    supportsImageToVideo: boolean;
    supportsMultiImage: boolean;
    supportsIngredients?: boolean; // Google Flow Ingredients：多参考图合成（≥2 张自动触发）
    supportsAudio?: boolean;
    durations: number[];
    resolutions: string[];
    durationResolutionMap?: Record<number, string[]>;
    aspectRatios: string[];
}

const VIDEO_MODELS: VideoModelOption[] = [
    { id: 'google-flow-omni-flash', name: 'Google Flow · Omni Flash', provider: 'workflow', supportsTextToVideo: false, supportsImageToVideo: true, supportsMultiImage: false, supportsIngredients: true, durations: [4, 6, 8, 10], resolutions: ['自动'], aspectRatios: ['16:9', '9:16'] },
    { id: 'google-flow-veo-3-1-lite', name: 'Google Flow · Veo 3.1 - Lite', provider: 'workflow', supportsTextToVideo: false, supportsImageToVideo: true, supportsMultiImage: false, supportsIngredients: true, durations: [], resolutions: ['自动'], aspectRatios: ['16:9', '9:16'] },
    { id: 'jimeng-seedance-2-0-mini', name: '即梦 · Seedance 2.0 mini', provider: 'workflow', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsIngredients: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
    { id: 'jimeng-seedance-2-0-fast', name: '即梦 · Seedance 2.0 Fast VIP', provider: 'workflow', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsIngredients: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
    { id: 'jimeng-seedance-2-0', name: '即梦 · Seedance 2.0 VIP', provider: 'workflow', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsIngredients: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
    { id: 'jimeng-seedance-2-0-fast-standard', name: '即梦 · Seedance 2.0 Fast', provider: 'workflow', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsIngredients: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
    { id: 'jimeng-seedance-2-0-standard', name: '即梦 · Seedance 2.0', provider: 'workflow', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsIngredients: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
    // 供应商仅保留当前主模型，避免同一能力出现多套过时入口。
    { id: 'seedance-2-0', name: 'Seedance 2.0', provider: 'seedance', supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsAudio: true, durations: [4, 5, 6, 8, 10, 15], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
];

// Image model versions with metadata
// supportsImageToImage: Can use a single reference image (for image-to-image transformation)
// supportsMultiImage: Can use multiple reference images (2-4) via Multi-Image API
// aspectRatios: Supported aspect ratios for the model
const IMAGE_MODELS = [
    {
        id: 'codex-imagegen',
        name: 'Codex 生图',
        provider: 'codex',
        supportsImageToImage: true,
        supportsMultiImage: true,
        resolutions: ["Auto"],
        aspectRatios: ["Auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9"]
    },
    {
        id: 'google-flow-nano-banana-pro',
        name: 'Google Flow · Nano Banana Pro',
        provider: 'workflow',
        supportsImageToImage: true,
        supportsMultiImage: true,
        resolutions: ["自动"],
        aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"]
    },
    {
        id: 'google-flow-nano-banana-2',
        name: 'Google Flow · Nano Banana 2',
        provider: 'workflow',
        supportsImageToImage: true,
        supportsMultiImage: true,
        resolutions: ["自动"],
        aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"]
    },
    {
        id: 'google-flow-nano-banana-2-lite',
        name: 'Google Flow · Nano Banana 2 Lite',
        provider: 'workflow',
        supportsImageToImage: true,
        supportsMultiImage: true,
        resolutions: ["自动"],
        aspectRatios: ["1:1", "16:9", "4:3", "3:4", "9:16"]
    },
];

const NodeControlsComponent: React.FC<NodeControlsProps> = ({
    workflowId,
    data,
    inputUrl,
    isLoading,
    isSuccess,
    connectedReferences = [],
    onUpdate,
    onGenerate,
    onChangeAngleGenerate,
    onSelect,
    zoom,
    canvasTheme = 'dark'
}) => {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showSizeDropdown, setShowSizeDropdown] = useState(false);
    const [showAspectRatioDropdown, setShowAspectRatioDropdown] = useState(false);
    const [showDurationDropdown, setShowDurationDropdown] = useState(false);
    const [showResolutionDropdown, setShowResolutionDropdown] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [isUploadingVideo, setIsUploadingVideo] = useState(false);
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const [showPromptOptimizer, setShowPromptOptimizer] = useState(false);
    const [showImagePromptMenu, setShowImagePromptMenu] = useState(false);
    const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
    const [isGeneratingImagePrompt, setIsGeneratingImagePrompt] = useState(false);
    const [promptOptimizationError, setPromptOptimizationError] = useState('');
    const [mentionStart, setMentionStart] = useState<number | null>(null);
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionIndex, setMentionIndex] = useState(0);
    const promptRef = useRef<HTMLTextAreaElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const aspectRatioDropdownRef = useRef<HTMLDivElement>(null);
    const durationDropdownRef = useRef<HTMLDivElement>(null);
    const resolutionDropdownRef = useRef<HTMLDivElement>(null);
    const modelDropdownRef = useRef<HTMLDivElement>(null);
    const promptOptimizerRef = useRef<HTMLDivElement>(null);
    const imagePromptMenuRef = useRef<HTMLDivElement>(null);
    const videoUploadInputRef = useRef<HTMLInputElement>(null);
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt); // Track what we sent

    const connectedImageNodes = connectedReferences
        .filter(reference => (reference.kind === 'image' || reference.kind === 'video') && reference.url)
        .map(reference => ({
            id: reference.id,
            url: reference.kind === 'video' ? (reference.previewUrl || reference.url!) : reference.url!,
            type: reference.kind === 'video' ? NodeType.VIDEO : NodeType.IMAGE,
            // 素材名（素材库名或参考图N）。生成时会把它作为素材名传给生成平台，
            // 所以这里显示什么，提示词里就该 @ 什么——两边必须是同一个字符串。
            label: reference.label,
        }));
    const connectedAudioNodes = connectedReferences
        .filter(reference => reference.kind === 'audio' && reference.url)
        .map(reference => ({ id: reference.id, title: reference.title, url: reference.url! }));


    // Google Flow / 即梦 依赖本机浏览器自动化运行时，未配置时置灰并说明原因。
    const { browserModelsHint, isModelUnavailable } = useBrowserModels();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowSizeDropdown(false);
            }
            if (aspectRatioDropdownRef.current && !aspectRatioDropdownRef.current.contains(event.target as Node)) {
                setShowAspectRatioDropdown(false);
            }
            if (durationDropdownRef.current && !durationDropdownRef.current.contains(event.target as Node)) {
                setShowDurationDropdown(false);
            }
            if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
                setShowModelDropdown(false);
            }
            if (resolutionDropdownRef.current && !resolutionDropdownRef.current.contains(event.target as Node)) {
                setShowResolutionDropdown(false);
            }
            if (promptOptimizerRef.current && !promptOptimizerRef.current.contains(event.target as Node)) {
                setShowPromptOptimizer(false);
            }
            if (imagePromptMenuRef.current && !imagePromptMenuRef.current.contains(event.target as Node)) {
                setShowImagePromptMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Sync local prompt with data.prompt ONLY when it changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    // 两个以上画面输入时自动展开首尾帧排序。
    useEffect(() => {
        if (data.type === NodeType.VIDEO && connectedImageNodes.length >= 2) {
            setShowAdvanced(true);
        }
    }, [data.type, connectedImageNodes.length]);

    // Handle prompt change with debounce
    const handlePromptChange = (value: string) => {
        setLocalPrompt(value); // Update local state immediately for responsive typing
        lastSentPromptRef.current = value; // Track that we're about to send this

        // Debounce the parent update
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate(data.id, { prompt: value });
        }, 300); // 300ms debounce - increased for smoother typing
    };

    const updateMentionState = (value: string, cursor: number) => {
        const beforeCursor = value.slice(0, cursor);
        const atIndex = beforeCursor.lastIndexOf('@');
        if (atIndex < 0) {
            setMentionStart(null);
            return;
        }
        const query = beforeCursor.slice(atIndex + 1);
        if (/\s/.test(query) || query.length > 16) {
            setMentionStart(null);
            return;
        }
        setMentionStart(atIndex);
        setMentionQuery(query);
        setMentionIndex(0);
    };

    const mentionOptions = connectedReferences.filter(reference => {
        const query = mentionQuery.trim().toLowerCase();
        return !query || reference.label.toLowerCase().includes(query) || reference.title.toLowerCase().includes(query);
    });
    const activeReferenceLabels = extractReferenceLabels(localPrompt, connectedReferences);

    const insertReferenceMention = (reference: NodeReference) => {
        const textarea = promptRef.current;
        const cursor = mentionStart !== null
            ? textarea?.selectionStart ?? localPrompt.length
            : textarea && document.activeElement === textarea
                ? textarea.selectionStart
                : localPrompt.length;
        const replaceStart = mentionStart ?? cursor;
        const nextValue = `${localPrompt.slice(0, replaceStart)}@${reference.label} ${localPrompt.slice(cursor)}`;
        const nextCursor = replaceStart + reference.label.length + 2;
        handlePromptChange(nextValue);
        setMentionStart(null);
        requestAnimationFrame(() => {
            textarea?.focus();
            textarea?.setSelectionRange(nextCursor, nextCursor);
        });
    };

    const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionStart === null || mentionOptions.length === 0) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setMentionIndex(current => (current + direction + mentionOptions.length) % mentionOptions.length);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            insertReferenceMention(mentionOptions[mentionIndex] || mentionOptions[0]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setMentionStart(null);
        }
    };

    const handleSizeSelect = (value: string) => {
        if (data.type === NodeType.VIDEO) {
            onUpdate(data.id, { resolution: value });
        } else {
            onUpdate(data.id, { aspectRatio: value });
        }
        setShowSizeDropdown(false);
    };

    const handleAspectRatioSelect = (value: string) => {
        onUpdate(data.id, { aspectRatio: value });
        setShowAspectRatioDropdown(false);
    };

    const handleVideoModeChange = (mode: 'standard' | 'frame-to-frame') => {
        if (mode === 'frame-to-frame') {
            // Initialize frameInputs from connected nodes
            const initialFrameInputs = connectedImageNodes.slice(0, 2).map((node, idx) => ({
                nodeId: node.id,
                order: idx === 0 ? 'start' : 'end' as 'start' | 'end'
            }));
            onUpdate(data.id, { videoMode: mode, frameInputs: initialFrameInputs });
        } else {
            onUpdate(data.id, { videoMode: mode, frameInputs: undefined });
        }
    };

    const handleFrameReorder = (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || connectedImageNodes.length < 2) return;

        // Get the two connected nodes
        const node1 = connectedImageNodes[0];
        const node2 = connectedImageNodes[1];

        // Get current orders (from saved data or default)
        const current1Order = data.frameInputs?.find(f => f.nodeId === node1.id)?.order || 'start';
        const current2Order = data.frameInputs?.find(f => f.nodeId === node2.id)?.order || 'end';

        // Swap the orders
        const updatedFrameInputs = [
            { nodeId: node1.id, order: current1Order === 'start' ? 'end' : 'start' as 'start' | 'end' },
            { nodeId: node2.id, order: current2Order === 'start' ? 'end' : 'start' as 'start' | 'end' }
        ];

        onUpdate(data.id, { frameInputs: updatedFrameInputs });
    };

    const currentSizeLabel = (data.type === NodeType.VIDEO)
        ? (data.resolution || "Auto")
        : (data.aspectRatio || "Auto");

    // For image nodes, use model-specific aspect ratios (sizeOptions for video computed later with availableResolutions)
    const currentImageModelForRatios = IMAGE_MODELS.find(m => m.id === data.imageModel) || IMAGE_MODELS[0];
    const imageAspectRatioOptions = currentImageModelForRatios.aspectRatios || IMAGE_RATIOS;
    const isVideoNode = data.type === NodeType.VIDEO;
    const isImageNode = data.type === NodeType.IMAGE;
    const hasConnectedImages = connectedImageNodes.length > 0;

    // Video model selection logic
    const currentVideoModel = VIDEO_MODELS.find(m => m.id === data.videoModel) || VIDEO_MODELS[0];
    const currentVideoAspectRatio = currentVideoModel.aspectRatios.includes(data.aspectRatio || '')
        ? data.aspectRatio!
        : currentVideoModel.aspectRatios[0];
    const isFrameToFrame = data.videoMode === 'frame-to-frame';

    // Determine video generation mode based on inputs and settings
    // 旧版动作控制模型已移除；连接视频时使用其末帧继续生成。
    const visualInputCount = connectedImageNodes.filter(n => n.type === NodeType.IMAGE || n.type === NodeType.VIDEO).length;

    const videoGenerationMode = (isFrameToFrame || visualInputCount >= 2) ? 'frame-to-frame'
            : (inputUrl || visualInputCount > 0) ? 'image-to-video'
                : 'text-to-video';

    // Filter video models based on mode
    const availableVideoModels = VIDEO_MODELS.filter(model => {
        // 未装浏览器自动化运行时的 Flow / 即梦 不参与「自动选中」，
        // 否则新建节点会默认停在一个点不动的模型上。它们仍会在下拉里显示（置灰）。
        if (isModelUnavailable(model.id)) return false;
        if (videoGenerationMode === 'text-to-video') return model.supportsTextToVideo;
        if (videoGenerationMode === 'image-to-video') return model.supportsImageToVideo;
        return model.supportsMultiImage || Boolean(model.supportsIngredients); // frame-to-frame / Ingredients 多参考图
    });
    const workflowVideoModels = VIDEO_MODELS.filter(model => model.provider === 'workflow');

    const getVideoModelUnavailableReason = (model: VideoModelOption) => {
        // 浏览器自动化模型（Flow / 即梦）需要本机 Python 运行时，未装时先于能力判断置灰。
        if (isModelUnavailable(model.id)) {
            return browserModelsHint;
        }
        if (videoGenerationMode === 'text-to-video' && !model.supportsTextToVideo) {
            return '需连接一张首帧图片';
        }
        if (videoGenerationMode === 'image-to-video' && !model.supportsImageToVideo) {
            return '不支持图片生成视频';
        }
        if (videoGenerationMode === 'frame-to-frame' && !model.supportsMultiImage && !model.supportsIngredients) {
            return '仅支持单张首帧';
        }
        return '';
    };

    // Auto-select first available video model when current is no longer valid
    useEffect(() => {
        if (data.type !== NodeType.VIDEO) return;

        const isCurrentModelAvailable = availableVideoModels.some(m => m.id === data.videoModel);
        if (!isCurrentModelAvailable && availableVideoModels.length > 0) {
            onUpdate(data.id, { videoModel: availableVideoModels[0].id });
        }
    }, [videoGenerationMode, data.videoModel, data.type, data.id, availableVideoModels, onUpdate]);

    useEffect(() => {
        if (data.type !== NodeType.VIDEO || currentVideoModel.aspectRatios.includes(data.aspectRatio || '')) return;
        onUpdate(data.id, { aspectRatio: currentVideoModel.aspectRatios[0] });
    }, [currentVideoModel.id, currentVideoModel.aspectRatios, data.aspectRatio, data.id, data.type, onUpdate]);

    const handleVideoModelChange = (modelId: string) => {
        const newModel = VIDEO_MODELS.find(m => m.id === modelId);
        const updates: Partial<typeof data> = {
            videoModel: modelId,
            errorMessage: undefined
        };

        // Reset duration if current duration is not supported by new model
        if (newModel?.durations && data.videoDuration && !newModel.durations.includes(data.videoDuration)) {
            // 目标模型不提供时长选择时，清空而不是取 durations[0]（那会是 undefined）,
            // 否则会把上一个模型的时长带过去，导致 DURATION_NOT_SUPPORTED。
            updates.videoDuration = newModel.durations.length > 0 ? newModel.durations[0] : undefined;
        }

        // Reset resolution if current resolution is not supported by new model
        // Normalize to lowercase for comparison
        if (newModel?.resolutions && data.resolution) {
            const currentRes = data.resolution.toLowerCase();
            const supportedRes = newModel.resolutions.map(r => r.toLowerCase());
            if (!supportedRes.includes(currentRes)) {
                updates.resolution = newModel.resolutions[0];
            }
        }

        if (newModel?.aspectRatios && !newModel.aspectRatios.includes(data.aspectRatio || '')) {
            updates.aspectRatio = newModel.aspectRatios[0];
        }

        onUpdate(data.id, updates);
        setShowModelDropdown(false);
    };

    // Get available durations for current model
    // 注意：空数组是 truthy，所以「不提供时长选择」的模型会正确得到 []，
    // 下游 `availableDurations.length > 0` 的守卫据此隐藏时长控件。
    const availableDurations = currentVideoModel.durations || [5];
    const currentDuration = data.videoDuration || availableDurations[0];

    const canOptimizePrompt = Boolean(localPrompt.trim()) || (isImageNode && connectedReferences.length > 0);

    const handleOptimizePrompt = async (profile: PromptOptimizationProfile) => {
        const sourcePrompt = localPrompt.trim() || (isImageNode
            ? `严格基于${connectedReferences.map(reference => `@${reference.label}`).join('、')}，保持同一人物身份与已经确认的造型。`
            : '');
        if (!sourcePrompt || isOptimizingPrompt) return;

        setIsOptimizingPrompt(true);
        setPromptOptimizationError('');
        setShowPromptOptimizer(false);

        try {
            const response = await fetch('/api/prompt/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: sourcePrompt,
                    profileId: profile.id,
                    context: {
                        targetModel: isVideoNode ? currentVideoModel.id : data.imageModel,
                        aspectRatio: data.aspectRatio,
                        duration: isVideoNode ? currentDuration : undefined
                    }
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.optimizedPrompt) {
                throw new Error(result.error || '提示词优化失败');
            }

            if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
            const optimizedPrompt = String(result.optimizedPrompt);
            setLocalPrompt(optimizedPrompt);
            lastSentPromptRef.current = optimizedPrompt;

            const updates: Partial<NodeData> = { prompt: optimizedPrompt };
            if (isImageNode && profile.aspectRatio && imageAspectRatioOptions.includes(profile.aspectRatio)) {
                updates.aspectRatio = profile.aspectRatio;
            }
            onUpdate(data.id, updates);
        } catch (error) {
            console.error('Prompt optimization failed:', error);
            setPromptOptimizationError(error instanceof Error ? error.message : '提示词优化失败');
        } finally {
            setIsOptimizingPrompt(false);
        }
    };

    const handleGenerateImagePrompt = async (mode: ReverseImagePromptMode) => {
        if (!isImageNode || !data.resultUrl || isGeneratingImagePrompt) return;

        setIsGeneratingImagePrompt(true);
        setPromptOptimizationError('');
        setShowPromptOptimizer(false);
        setShowImagePromptMenu(false);

        try {
            const response = await fetch('/api/gemini/describe-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl: data.resultUrl,
                    prompt: buildReverseImagePromptInstruction(mode)
                })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.description) {
                throw new Error(result.error || '图片提示词生成失败');
            }

            if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
            const generatedPrompt = String(result.description).trim();
            setLocalPrompt(generatedPrompt);
            lastSentPromptRef.current = generatedPrompt;
            onUpdate(data.id, { prompt: generatedPrompt });
            requestAnimationFrame(() => promptRef.current?.focus());
        } catch (error) {
            console.error('Image prompt generation failed:', error);
            setPromptOptimizationError(error instanceof Error ? error.message : '图片提示词生成失败');
        } finally {
            setIsGeneratingImagePrompt(false);
        }
    };

    // Get available resolutions for current model (considering duration for models with durationResolutionMap)
    const getAvailableResolutions = () => {
        const model = currentVideoModel;
        if (model.durationResolutionMap && currentDuration) {
            return model.durationResolutionMap[currentDuration] || model.resolutions || VIDEO_RESOLUTIONS;
        }
        return model.resolutions || VIDEO_RESOLUTIONS;
    };
    const availableResolutions = getAvailableResolutions();

    // sizeOptions: For video nodes use model-specific resolutions, for image nodes use aspect ratios
    const sizeOptions = (data.type === NodeType.VIDEO)
        ? availableResolutions
        : imageAspectRatioOptions;

    const handleDurationChange = (duration: number) => {
        const model = currentVideoModel;
        const updates: Partial<typeof data> = { videoDuration: duration };

        // If model has duration-specific resolutions, reset resolution if needed
        if (model.durationResolutionMap) {
            const allowedResolutions = model.durationResolutionMap[duration] || model.resolutions;
            if (data.resolution && !allowedResolutions.includes(data.resolution.toLowerCase())) {
                updates.resolution = allowedResolutions[0];
            }
        }

        onUpdate(data.id, updates);
        setShowDurationDropdown(false);
    };

    // Image model selection logic
    const currentImageModel = IMAGE_MODELS.find(m => m.id === data.imageModel) || IMAGE_MODELS[0];

    // Filter image models based on connected inputs
    // 0 inputs = all models, 1 input = needs supportsImageToImage, 2+ inputs = needs supportsMultiImage
    const inputCount = connectedImageNodes.length;
    const availableImageModels = IMAGE_MODELS.filter(model => {
        if (inputCount === 0) return true; // Text-to-image: all models work
        if (inputCount === 1) return model.supportsImageToImage; // Single ref: filter out V2.1
        return model.supportsMultiImage; // Multi-ref: filter out V1, V1.5, V2 New
    });

    // Auto-select first available model when current model is no longer valid for the mode
    useEffect(() => {
        if (data.type !== NodeType.IMAGE && data.type !== NodeType.IMAGE_EDITOR) return;

        // 这里额外排掉未配置的浏览器自动化模型：availableImageModels 还要喂下拉渲染
        // （需要显示但置灰），所以不能在上面的过滤里直接去掉。
        const selectable = availableImageModels.filter(m => !isModelUnavailable(m.id));
        const isCurrentModelAvailable = selectable.some(m => m.id === data.imageModel);
        if (!isCurrentModelAvailable && selectable.length > 0) {
            // Auto-select first available model
            onUpdate(data.id, { imageModel: selectable[0].id });
        }
    }, [inputCount, data.imageModel, data.type, data.id, availableImageModels, onUpdate]);

    // Determine current generation mode for display
    const imageGenerationMode = inputCount === 0 ? 'text-to-image'
        : inputCount === 1 ? 'image-to-image'
            : 'multi-image';

    const handleImageModelChange = (modelId: string) => {
        const newModel = IMAGE_MODELS.find(m => m.id === modelId);
        const updates: Partial<typeof data> = { imageModel: modelId };

        // Reset aspect ratio if current ratio is not supported by new model
        if (newModel?.aspectRatios && data.aspectRatio && !newModel.aspectRatios.includes(data.aspectRatio)) {
            updates.aspectRatio = newModel.aspectRatios[0] || 'Auto';
        }

        // Reset resolution if current resolution is not supported by new model
        if (newModel?.resolutions && data.resolution && !newModel.resolutions.includes(data.resolution)) {
            updates.resolution = newModel.resolutions[0] || 'Auto';
        }

        onUpdate(data.id, updates);
        setShowModelDropdown(false);
    };

    const handleResolutionSelect = (value: string) => {
        onUpdate(data.id, { resolution: value });
        setShowResolutionDropdown(false);
    };

    const handleLocalVideoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const supportedExtension = /\.(mp4|webm|mov|m4v)$/i.test(file.name);
        if (!file.type.startsWith('video/') && !supportedExtension) {
            alert('请选择视频文件。');
            return;
        }

        if (file.size > 100 * 1024 * 1024) {
            alert('视频文件不能超过 100MB。');
            return;
        }

        setIsUploadingVideo(true);
        try {
            const metadata = await new Promise<{ duration?: number; width?: number; height?: number }>((resolve) => {
                const video = document.createElement('video');
                const objectUrl = URL.createObjectURL(file);
                video.preload = 'metadata';
                video.onloadedmetadata = () => {
                    const result = {
                        duration: Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : undefined,
                        width: video.videoWidth || undefined,
                        height: video.videoHeight || undefined,
                    };
                    URL.revokeObjectURL(objectUrl);
                    resolve(result);
                };
                video.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    resolve({});
                };
                video.src = objectUrl;
            });

            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => reject(new Error('读取视频文件失败'));
                reader.readAsDataURL(file);
            });

            const response = await fetch('/api/assets/videos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: dataUrl,
                    prompt: file.name,
                    originalFilename: file.name,
                    mimeType: file.type,
                    workflowId,
                }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.url) {
                throw new Error(result?.error || '上传视频失败');
            }

            let resultAspectRatio: string | undefined;
            let aspectRatio = data.aspectRatio || '16:9';
            let resolution = data.resolution || 'Auto';
            if (metadata.width && metadata.height) {
                resultAspectRatio = `${metadata.width}/${metadata.height}`;
                const greatestCommonDivisor = (a: number, b: number): number => b === 0 ? a : greatestCommonDivisor(b, a % b);
                const divisor = greatestCommonDivisor(metadata.width, metadata.height);
                aspectRatio = `${metadata.width / divisor}:${metadata.height / divisor}`;
                resolution = `${Math.min(metadata.width, metadata.height)}p`;
            }

            onUpdate(data.id, {
                resultUrl: result.url,
                resultAspectRatio,
                aspectRatio,
                resolution,
                videoDuration: metadata.duration || data.videoDuration,
                model: '本地上传',
                status: NodeStatus.SUCCESS,
                errorMessage: undefined,
                generationStartTime: undefined,
                lastFrame: undefined,
                trimStart: undefined,
                trimEnd: undefined,
            });
        } catch (error) {
            console.error('本地视频上传失败:', error);
            alert(error instanceof Error ? error.message : '上传视频失败，请稍后重试。');
        } finally {
            setIsUploadingVideo(false);
        }
    };

    // 当前模型把连进来的图当「参考素材」还是「首尾帧」。
    // 即梦没有首帧概念，连 3 张图却显示成首帧/尾帧、还丢掉第 3 张，是明确的误导。
    const useReferenceMaterials = shouldUseReferenceImages(data.videoModel, connectedImageNodes.length);
    const referenceOnlyModel = usesReferenceMaterialsOnly(data.videoModel);
    // 参考素材模式下全部展示（不截断到 2 张）；首尾帧模式仍然只取前两张。
    const referenceInputsWithUrls = connectedImageNodes.map(node => ({
        nodeId: node.id,
        url: node.url,
        type: node.type,
        label: node.label
    }));

    // Get frame inputs with their image URLs
    // Auto-assign order: first connected = start, second = end
    // If user has explicitly set frameInputs, use those orders, otherwise auto-assign
    const frameInputsWithUrls = connectedImageNodes.slice(0, 2).map((node, idx) => {
        // Check if there's an explicit order from user reordering
        const existingInput = data.frameInputs?.find(f => f.nodeId === node.id);
        return {
            nodeId: node.id,
            url: node.url,
            type: node.type,
            order: existingInput?.order || (idx === 0 ? 'start' : 'end') as 'start' | 'end'
        };
    }).sort((a, b) => {
        // Sort by order: 'start' first, 'end' second
        if (a.order === 'start' && b.order === 'end') return -1;
        if (a.order === 'end' && b.order === 'start') return 1;
        return 0;
    });

    // 操作面板始终保持固定屏幕尺寸，不跟随画布缩放。
    const localScale = 1 / Math.max(zoom, 0.01);

    // Theme helper
    const isDark = canvasTheme === 'dark';

    // Handle angle mode generate - creates a new connected node
    const handleAngleGenerate = () => {
        if (onChangeAngleGenerate) {
            onChangeAngleGenerate(data.id);
        }
    };

    // If in angle mode for Image nodes with result, show ChangeAnglePanel
    if (data.angleMode && data.type === NodeType.IMAGE && isSuccess && data.resultUrl) {
        return (
            <div
                style={{
                    transform: `scale(${localScale})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.1s ease-out'
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(data.id)}
            >
                <ChangeAnglePanel
                    imageUrl={data.resultUrl}
                    settings={data.angleSettings || { rotation: 0, tilt: 0, scale: 0 }}
                    onSettingsChange={(settings) => onUpdate(data.id, { angleSettings: settings })}
                    onClose={() => onUpdate(data.id, { angleMode: false })}
                    onGenerate={handleAngleGenerate}
                    isLoading={isLoading}
                    canvasTheme={canvasTheme}
                />
            </div>
        );
    }

    return (
        <div
            className={`w-full cursor-default rounded-2xl p-5 shadow-2xl transition-colors duration-300 ${isDark ? 'bg-[#1a1a1a] border border-neutral-800' : 'bg-white border border-neutral-200'}`}
            style={{
                transform: `scale(${localScale})`,
                transformOrigin: 'top center',
                transition: 'transform 0.1s ease-out'
            }}
            onPointerDown={(e) => e.stopPropagation()} // Allow selecting text/interacting without dragging
            onClick={() => onSelect(data.id)} // Ensure clicking here selects the node
        >
            {/* Prompt Textarea with Expand Button - Hidden for storyboard-generated scenes */}
            {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                <div className="relative mb-3">
                    <div className="mb-3 flex min-h-[38px] items-start gap-3">
                        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" aria-label="已连接参考素材">
                            {connectedReferences.map(reference => (
                                <button
                                    key={reference.id}
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        insertReferenceMention(reference);
                                    }}
                                    className={`group/reference relative h-[62px] w-[54px] flex-none overflow-hidden rounded-lg border text-left transition-colors ${activeReferenceLabels.size > 0 && activeReferenceLabels.has(reference.label)
                                        ? 'border-cyan-400 bg-cyan-500/10 ring-1 ring-cyan-400/40'
                                        : isDark ? 'border-neutral-700 bg-[#252525] hover:border-cyan-500' : 'border-neutral-300 bg-neutral-100 hover:border-cyan-500'}`}
                                    title={`点击插入 @${reference.label}：${reference.title}`}
                                >
                                    {reference.kind === 'audio' ? (
                                        <div className="flex h-[40px] items-center justify-center bg-cyan-950/40 text-cyan-300">
                                            <Mic2 size={20} />
                                        </div>
                                    ) : reference.previewUrl ? (
                                        reference.kind === 'video' && !reference.previewUrl.match(/\.(png|jpe?g|webp|gif)(\?|$)/i) ? (
                                            <video src={reference.previewUrl} className="h-[40px] w-full object-cover" muted preload="metadata" />
                                        ) : (
                                            <img src={reference.previewUrl} alt={reference.label} className="h-[40px] w-full object-cover" />
                                        )
                                    ) : (
                                        <div className="flex h-[40px] items-center justify-center text-neutral-500">
                                            {reference.kind === 'video' ? <Film size={18} /> : <ImageIcon size={18} />}
                                        </div>
                                    )}
                                    <span className="block truncate px-1 py-0.5 text-[10px] font-medium text-neutral-300">
                                        {reference.label}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {(isImageNode || isVideoNode) && (
                            <div className="flex flex-none items-start gap-2">
                                {isImageNode && (
                                    <div className="relative" ref={imagePromptMenuRef}>
                                        <button
                                            type="button"
                                            disabled={!data.resultUrl || isGeneratingImagePrompt || isOptimizingPrompt}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setShowPromptOptimizer(false);
                                                setShowImagePromptMenu(current => !current);
                                            }}
                                            className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isDark
                                                ? 'border-neutral-700 bg-[#252525] text-neutral-200 hover:border-cyan-500 hover:bg-cyan-500/10 hover:text-cyan-300'
                                                : 'border-neutral-300 bg-white text-neutral-700 hover:border-cyan-500 hover:bg-cyan-50 hover:text-cyan-700'}`}
                                            title={data.resultUrl ? '选择当前节点图片的反推模式' : '当前节点生成图片后才可反推提示词'}
                                        >
                                            {isGeneratingImagePrompt ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
                                            <span>{isGeneratingImagePrompt ? '识别中' : '生成图片提示词'}</span>
                                            <ChevronDown size={13} className="opacity-60" />
                                        </button>

                                        {showImagePromptMenu && (
                                            <div className={`absolute right-0 top-full z-[180] mt-2 w-72 overflow-hidden rounded-xl border p-1.5 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#252525]' : 'border-neutral-200 bg-white'}`}>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void handleGenerateImagePrompt('normal');
                                                    }}
                                                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${isDark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                                                >
                                                    <span className={`block text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>正常图片提示词</span>
                                                    <span className="mt-0.5 block text-xs text-neutral-500">完整识别画面，包括可见文案与字幕</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void handleGenerateImagePrompt('no-text');
                                                    }}
                                                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${isDark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                                                >
                                                    <span className={`block text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>去除文案字幕</span>
                                                    <span className="mt-0.5 block text-xs text-neutral-500">忽略文字、标题、标签、水印和排版描述</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="relative" ref={promptOptimizerRef}>
                                <button
                                    type="button"
                                    disabled={!canOptimizePrompt || isOptimizingPrompt || isGeneratingImagePrompt}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setShowImagePromptMenu(false);
                                        setShowPromptOptimizer(current => !current);
                                    }}
                                    className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isDark
                                        ? 'border-neutral-700 bg-[#252525] text-neutral-200 hover:border-violet-500 hover:bg-violet-500/10 hover:text-violet-300'
                                        : 'border-neutral-300 bg-white text-neutral-700 hover:border-violet-500 hover:bg-violet-50 hover:text-violet-700'}`}
                                    title={isImageNode ? '选择图片提示词优化类型' : '选择视频提示词优化类型'}
                                >
                                    {isOptimizingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                    <span>{isOptimizingPrompt ? '优化中' : '提示词优化'}</span>
                                    <ChevronDown size={13} className="opacity-60" />
                                </button>

                                {isVideoNode && showPromptOptimizer && (
                                    <div className={`absolute right-0 top-full z-[180] mt-2 w-72 overflow-hidden rounded-xl border p-1.5 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#252525]' : 'border-neutral-200 bg-white'}`}>
                                        {VIDEO_PROMPT_OPTIMIZATION_PROFILES.map(profile => {
                                            // 两种提示词风格互不通用：Flow 不认 @tag，即梦靠 @tag 指图。
                                            // 这里把与当前所选模型匹配的那个标出来，避免选错。
                                            const matched = resolveVideoProfileForModel(data.videoModel).id === profile.id;
                                            return (
                                            <button
                                                key={profile.id}
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleOptimizePrompt(profile);
                                                }}
                                                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${isDark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                                            >
                                                <span className={`flex items-center gap-2 text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                                                    {profile.label}
                                                    {matched && (
                                                        <span className="rounded bg-green-600/30 px-1 py-0.5 text-[9px] font-medium text-green-400">
                                                            匹配当前模型
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-neutral-500">{profile.description}</span>
                                            </button>
                                            );
                                        })}
                                    </div>
                                )}

                                {isImageNode && showPromptOptimizer && (
                                    <div className={`absolute right-0 top-full z-[180] mt-2 w-72 overflow-hidden rounded-xl border p-1.5 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#252525]' : 'border-neutral-200 bg-white'}`}>
                                        {IMAGE_PROMPT_OPTIMIZATION_PROFILES.map(profile => (
                                            <button
                                                key={profile.id}
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void handleOptimizePrompt(profile);
                                                }}
                                                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${isDark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
                                            >
                                                <span className={`block text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>{profile.label}</span>
                                                <span className="mt-0.5 block text-xs text-neutral-500">{profile.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {promptOptimizationError && (
                                    <div className="mt-1 max-w-72 text-right text-[11px] text-red-400">{promptOptimizationError}</div>
                                )}
                                </div>
                            </div>
                        )}
                    </div>
                    <textarea
                        ref={promptRef}
                        className={`w-full resize-none bg-transparent text-[17px] font-normal leading-7 outline-none ${isDark ? 'text-white placeholder-neutral-600' : 'text-neutral-900 placeholder-neutral-400'}`}
                        placeholder={data.type === NodeType.VIDEO && inputUrl
                            ? "描述这个画面要如何运动，输入 @ 选择参考素材..."
                            : "描述你想生成的内容，输入 @ 选择参考素材..."}
                        rows={data.isPromptExpanded ? 12 : 4}
                        value={localPrompt}
                        onChange={(e) => {
                            handlePromptChange(e.target.value);
                            updateMentionState(e.target.value, e.target.selectionStart);
                        }}
                        onKeyDown={handlePromptKeyDown}
                        onClick={(e) => updateMentionState(e.currentTarget.value, e.currentTarget.selectionStart)}
                        onWheel={(e) => e.stopPropagation()}
                        onBlur={() => {
                            // Ensure final value is saved on blur
                            if (updateTimeoutRef.current) {
                                clearTimeout(updateTimeoutRef.current);
                            }
                            if (localPrompt !== data.prompt) {
                                onUpdate(data.id, { prompt: localPrompt });
                            }
                        }}
                    />
                    {mentionStart !== null && (
                        <div className={`absolute left-0 right-0 top-full z-[160] mt-1 max-h-56 overflow-y-auto rounded-xl border p-1.5 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#252525]' : 'border-neutral-200 bg-white'}`}>
                            {mentionOptions.length > 0 ? mentionOptions.map((reference, index) => (
                                <button
                                    key={reference.id}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        insertReferenceMention(reference);
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${index === mentionIndex ? 'bg-cyan-500/15 text-cyan-300' : isDark ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-800 hover:bg-neutral-100'}`}
                                >
                                    <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-md bg-neutral-800">
                                        {reference.kind === 'audio' ? <Mic2 size={17} />
                                            : reference.previewUrl
                                                ? reference.kind === 'video' && !reference.previewUrl.match(/\.(png|jpe?g|webp|gif)(\?|$)/i)
                                                    ? <video src={reference.previewUrl} className="h-full w-full object-cover" muted preload="metadata" />
                                                    : <img src={reference.previewUrl} alt="" className="h-full w-full object-cover" />
                                                : reference.kind === 'video' ? <Film size={17} /> : <ImageIcon size={17} />}
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-semibold">@{reference.label}</span>
                                        <span className="block truncate text-xs text-neutral-500">{reference.title}</span>
                                    </span>
                                </button>
                            )) : (
                                <div className="px-3 py-3 text-sm text-neutral-500">没有匹配的参考素材</div>
                            )}
                        </div>
                    )}
                    {/* Expand/Shrink Button - Below textarea */}
                    <div className="flex justify-end mt-1">
                        <button
                            onClick={() => onUpdate(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${isDark ? 'text-neutral-400 hover:text-white hover:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200'}`}
                            title={data.isPromptExpanded ? '收起提示词' : '展开提示词'}
                        >
                            {data.isPromptExpanded ? <Shrink size={14} /> : <Expand size={14} />}
                            <span>{data.isPromptExpanded ? '收起' : '展开'}</span>
                        </button>
                    </div>
                </div>
            )}

            {data.errorMessage && (
                <div className="text-red-400 text-xs mb-2 p-1 bg-red-900/20 rounded border border-red-900/50">
                    {data.errorMessage}
                </div>
            )}

            {/* Controls - Hidden for storyboard-generated scenes */}
            {!(data.prompt && data.prompt.startsWith('Extract panel #')) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 relative">
                    <div className="flex min-w-0 items-center gap-2">
                        {/* Model Selector - Local, Video, and Image nodes get different dropdowns */}
                        {data.type === NodeType.VIDEO ? (
                            <div className="relative" ref={modelDropdownRef}>
                                <button
                                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                                    className="flex min-w-[142px] items-center gap-1.5 whitespace-nowrap text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    <Film size={12} className="text-cyan-400" />
                                    <span className="font-medium whitespace-nowrap">{currentVideoModel.name}</span>
                                    <ChevronDown size={12} className="ml-0.5 opacity-50" />
                                </button>

                                {/* Model Dropdown Menu */}
                                {showModelDropdown && (
                                    <div className="absolute top-full mt-1 left-0 w-56 max-h-[65vh] overflow-y-auto bg-[#252525] border border-neutral-700 rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100">
                                        {/* Local Upload */}
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setShowModelDropdown(false);
                                                videoUploadInputRef.current?.click();
                                            }}
                                            disabled={isUploadingVideo}
                                            title="上传本地生成的视频，并保存到个人素材库"
                                            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-left text-white hover:bg-[#333] transition-colors border-b border-neutral-700 disabled:cursor-wait disabled:opacity-60"
                                        >
                                            {isUploadingVideo
                                                ? <Loader2 size={12} className="animate-spin text-cyan-400" />
                                                : <Upload size={12} className="text-cyan-400" />}
                                            <span>{isUploadingVideo ? '上传中...' : '本地上传'}</span>
                                        </button>
                                        {/* Mode indicator */}
                                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider bg-[#1a1a1a] border-b border-neutral-700 flex items-center gap-1.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${videoGenerationMode === 'text-to-video' ? 'bg-blue-400' :
                                                videoGenerationMode === 'image-to-video' ? 'bg-green-400' : 'bg-purple-400'
                                                }`} />
                                            {videoGenerationMode === 'text-to-video' ? '文本 → 视频' :
                                                videoGenerationMode === 'image-to-video' ? '图片 → 视频' : '首尾帧'}
                                        </div>
                                        {/* Local workflow models */}
                                        {workflowVideoModels.length > 0 && (
                                            <>
                                                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f] border-t border-neutral-700">
                                                    本地工作流
                                                </div>
                                                {workflowVideoModels.map(model => {
                                                    const unavailableReason = getVideoModelUnavailableReason(model);
                                                    const isUnavailable = Boolean(unavailableReason);
                                                    return (
                                                        <button
                                                            key={model.id}
                                                            onClick={() => !isUnavailable && handleVideoModelChange(model.id)}
                                                            disabled={isUnavailable}
                                                            title={unavailableReason || model.name}
                                                            className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${isUnavailable
                                                                ? 'cursor-not-allowed text-neutral-600'
                                                                : `hover:bg-[#333] ${currentVideoModel.id === model.id ? 'text-blue-400' : 'text-neutral-300'}`
                                                                }`}
                                                        >
                                                            <span className="flex items-center gap-2">
                                                                <Film size={12} className={isUnavailable ? 'text-neutral-600' : 'text-cyan-400'} />
                                                                <span className="flex flex-col gap-0.5">
                                                                    <span className="flex items-center gap-2">
                                                                        {model.name}
                                                                    </span>
                                                                    {unavailableReason && (
                                                                        <span className="text-[10px] font-normal text-amber-500/80">{unavailableReason}</span>
                                                                    )}
                                                                </span>
                                                            </span>
                                                            {currentVideoModel.id === model.id && !isUnavailable && <Check size={12} />}
                                                        </button>
                                                    );
                                                })}
                                            </>
                                        )}

                                        {/* Seedance Models */}
                                        {availableVideoModels.filter(m => m.provider === 'seedance').length > 0 && (
                                            <>
                                                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f] border-t border-neutral-700">
                                                    Seedance
                                                </div>
                                                {availableVideoModels.filter(m => m.provider === 'seedance').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleVideoModelChange(model.id)}
                                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${currentVideoModel.id === model.id ? 'text-blue-400' : 'text-neutral-300'}`}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <Film size={12} className="text-cyan-400" />
                                                            {model.name}
                                                        </span>
                                                        {currentVideoModel.id === model.id && <Check size={12} />}
                                                    </button>
                                                ))}
                                            </>
                                        )}

                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="relative" ref={modelDropdownRef}>
                                <button
                                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                                    className="flex items-center gap-1.5 text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    {currentImageModel.provider === 'workflow' ? (
                                        <Banana size={12} className="text-cyan-400" />
                                    ) : currentImageModel.provider === 'codex' ? (
                                        <Sparkles size={12} className="text-blue-400" />
                                    ) : (
                                        <ImageIcon size={12} className="text-cyan-400" />
                                    )}
                                    <span className="font-medium">{currentImageModel.name}</span>
                                    <ChevronDown size={12} className="ml-0.5 opacity-50" />
                                </button>

                                {/* Image Model Dropdown Menu */}
                                {showModelDropdown && (
                                    <div className="absolute top-full mt-1 left-0 w-48 bg-[#252525] border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                                        {/* Mode indicator */}
                                        <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-400 uppercase tracking-wider bg-[#1a1a1a] border-b border-neutral-700 flex items-center gap-1.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${imageGenerationMode === 'text-to-image' ? 'bg-blue-400' :
                                                imageGenerationMode === 'image-to-image' ? 'bg-green-400' : 'bg-purple-400'
                                                }`} />
                                            {imageGenerationMode === 'text-to-image' ? '文本 → 图片' :
                                                imageGenerationMode === 'image-to-image' ? '图片 → 图片' :
                                                    `${inputCount} 张图片 → 图片`}
                                        </div>
                                        {/* Codex 本地生图 */}
                                        {availableImageModels.filter(m => m.provider === 'codex').length > 0 && (
                                            <>
                                                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">
                                                    本地生图
                                                </div>
                                                {availableImageModels.filter(m => m.provider === 'codex').map(model => (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => handleImageModelChange(model.id)}
                                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${currentImageModel.id === model.id ? 'text-blue-400' : 'text-neutral-300'}`}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <Sparkles size={12} className="text-blue-400" />
                                                            {model.name}
                                                        </span>
                                                        {currentImageModel.id === model.id && <Check size={12} />}
                                                    </button>
                                                ))}
                                            </>
                                        )}
                                        {/* Google Flow 本地 workflow */}
                                        {availableImageModels.filter(m => m.provider === 'workflow').length > 0 && (
                                            <>
                                                <div className="px-3 py-1.5 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f] border-t border-neutral-700">
                                                    Google Flow
                                                </div>
                                                {availableImageModels.filter(m => m.provider === 'workflow').map(model => {
                                                    const isUnavailable = isModelUnavailable(model.id);
                                                    return (
                                                    <button
                                                        key={model.id}
                                                        onClick={() => !isUnavailable && handleImageModelChange(model.id)}
                                                        disabled={isUnavailable}
                                                        title={isUnavailable ? browserModelsHint : model.name}
                                                        className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${isUnavailable
                                                            ? 'cursor-not-allowed text-neutral-600'
                                                            : `hover:bg-[#333] ${currentImageModel.id === model.id ? 'text-blue-400' : 'text-neutral-300'}`
                                                            }`}
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <Banana size={12} className={isUnavailable ? 'text-neutral-600' : 'text-cyan-400'} />
                                                            <span className="flex flex-col gap-0.5">
                                                                <span className="flex items-center gap-2">
                                                                    {model.name}
                                                                </span>
                                                                {isUnavailable && (
                                                                    <span className="text-[10px] font-normal text-amber-500/80">{browserModelsHint}</span>
                                                                )}
                                                            </span>
                                                        </span>
                                                        {currentImageModel.id === model.id && !isUnavailable && <Check size={12} />}
                                                    </button>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {isVideoNode && (
                            <input
                                ref={videoUploadInputRef}
                                type="file"
                                accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
                                className="hidden"
                                onChange={handleLocalVideoUpload}
                            />
                        )}
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
                        {/* Unified Size/Ratio Dropdown */}
                        <div className="relative" ref={dropdownRef}>
                                <button
                                    onClick={() => setShowSizeDropdown(!showSizeDropdown)}
                                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    {isVideoNode && <Monitor size={12} className="text-green-400" />}
                                    {!isVideoNode && <Crop size={12} className="text-blue-400" />}
                                    {currentSizeLabel === 'Auto' ? '自动' : currentSizeLabel}
                                </button>

                                {/* Dropdown Menu */}
                                {showSizeDropdown && (
                                    <div
                                        className="absolute bottom-full mb-2 right-0 w-32 bg-[#252525] border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-60 overflow-y-auto"
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">
                                            {isVideoNode ? '分辨率' : '画面比例'}
                                        </div>
                                        {sizeOptions.map(option => (
                                            <button
                                                key={option}
                                                onClick={() => handleSizeSelect(option)}
                                                className={`flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${currentSizeLabel === option ? 'text-blue-400' : 'text-neutral-300'
                                                    }`}
                                            >
                                                <span>{option === 'Auto' ? '自动' : option}</span>
                                                {currentSizeLabel === option && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                        </div>

                        {/* Image Resolution Dropdown - Only for Image nodes */}
                        {!isVideoNode && (currentImageModel as any).resolutions && (
                            <div className="relative" ref={resolutionDropdownRef}>
                                <button
                                    onClick={() => setShowResolutionDropdown(!showResolutionDropdown)}
                                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    <Monitor size={12} className="text-green-400" />
                                    {(data.resolution || 'Auto') === 'Auto' ? '自动' : data.resolution}
                                </button>

                                {/* Dropdown Menu */}
                                {showResolutionDropdown && (
                                    <div
                                        className="absolute bottom-full mb-2 right-0 w-24 bg-[#252525] border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100"
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">
                                            Quality
                                        </div>
                                        {(currentImageModel as any).resolutions.map((res: string) => (
                                            <button
                                                key={res}
                                                onClick={() => handleResolutionSelect(res)}
                                                className={`flex items-center justify-between w-full px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${(data.resolution || 'Auto') === res ? 'text-blue-400' : 'text-neutral-300'}`}
                                            >
                                                <span>{res}</span>
                                                {(data.resolution || 'Auto') === res && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Video Aspect Ratio Dropdown - Only for video nodes */}
                        {isVideoNode && (
                            <div className="relative" ref={aspectRatioDropdownRef}>
                                <button
                                    onClick={() => setShowAspectRatioDropdown(!showAspectRatioDropdown)}
                                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    <Film size={12} className="text-purple-400" />
                                    {currentVideoAspectRatio}
                                </button>

                                {/* Aspect Ratio Dropdown Menu */}
                                {showAspectRatioDropdown && (
                                    <div className="absolute bottom-full mb-2 right-0 w-28 bg-[#252525] border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                                        <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">
                                            Size
                                        </div>
                                        {(currentVideoModel?.aspectRatios || VIDEO_ASPECT_RATIOS).map((option: string) => (
                                            <button
                                                key={option}
                                                onClick={() => handleAspectRatioSelect(option)}
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${data.aspectRatio === option ? 'text-blue-400' : 'text-neutral-300'}`}
                                            >
                                                <span>{option}</span>
                                                {data.aspectRatio === option && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Duration Dropdown - Only for video nodes */}
                        {isVideoNode && availableDurations.length > 0 && (
                            <div className="relative" ref={durationDropdownRef}>
                                <button
                                    onClick={() => setShowDurationDropdown(!showDurationDropdown)}
                                    className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium bg-[#252525] hover:bg-[#333] border border-neutral-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                                >
                                    <Clock size={12} className="text-cyan-400" />
                                    {currentDuration}秒
                                </button>

                                {/* Duration Dropdown Menu */}
                                {showDurationDropdown && (
                                    <div className="absolute bottom-full mb-2 right-0 w-24 bg-[#252525] border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100">
                                        <div className="px-3 py-2 text-[10px] font-bold text-neutral-500 uppercase tracking-wider bg-[#1f1f1f]">
                                            时长
                                        </div>
                                        {availableDurations.map((dur: number) => (
                                            <button
                                                key={dur}
                                                onClick={() => handleDurationChange(dur)}
                                                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-[#333] transition-colors ${currentDuration === dur ? 'text-blue-400' : 'text-neutral-300'}`}
                                            >
                                                <span>{dur}秒</span>
                                                {currentDuration === dur && <Check size={12} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {isVideoNode && currentVideoModel.id === 'seedance-2-0' && connectedAudioNodes.length > 0 && (
                            <div
                                title={`固定音色参考：${connectedAudioNodes.map(node => node.title).join('、')}`}
                                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-200"
                            >
                                <Mic2 size={12} />
                                <span>音色参考 {connectedAudioNodes.length}</span>
                            </div>
                        )}

                        {/* Generate Button - Active even after success to allow re-generation */}
            {!isLoading && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onGenerate(data.id);
                    }}
                    className={'group w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ' + (isDark
                        ? 'bg-white text-neutral-900 hover:bg-neutral-100 active:scale-95'
                        : 'bg-neutral-900 text-white hover:bg-neutral-800 active:scale-95')}
                    title="生成"
                >
                    <svg
                        viewBox="0 0 24 24"
                        className="w-4 h-4 transition-transform duration-200"
                        fill="currentColor"
                    >
                        <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                </button>
            )}
                    </div>
                </div>
            )}

            {/* Advanced Settings Drawer - Only for Video nodes */}
            {
                isVideoNode && (
                    <div className="mt-2 pt-2 border-t border-neutral-800">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-center gap-1 cursor-pointer"
                        >
                            <span className="text-[10px] text-neutral-600 uppercase tracking-widest hover:text-neutral-400">
                                高级设置
                            </span>
                            {showAdvanced ? (
                                <ChevronUp size={12} className="text-neutral-600" />
                            ) : (
                                <ChevronDown size={12} className="text-neutral-600" />
                            )}
                        </button>

                        {/* Advanced Settings Content - Only for Video nodes */}
                        {showAdvanced && isVideoNode && (
                            <div className="mt-3 space-y-3">
                                {/* Frame Inputs - Show when 2+ nodes are connected */}
                                {(connectedImageNodes.length >= 2 || (useReferenceMaterials && connectedImageNodes.length >= 1)) && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] text-neutral-500 uppercase tracking-wider">
                                            {useReferenceMaterials ? (
                                                <>已连接参考素材<span className="text-neutral-600">（提示词里用 @名字 引用）</span></>
                                            ) : (
                                                <>已连接画面<span className="text-neutral-600">（拖动可排序）</span></>
                                            )}
                                        </label>

                                        {useReferenceMaterials ? (
                                            /* 参考素材模式：全部列出，不做首尾帧标注（该模型没有首帧概念） */
                                            <div className="space-y-2">
                                                {referenceInputsWithUrls.map((input, index) => (
                                                    <div
                                                        key={input.nodeId}
                                                        className="flex items-center gap-2 p-2 bg-neutral-800 rounded-lg"
                                                    >
                                                        <img
                                                            src={input.url}
                                                            alt={`Reference ${index + 1}`}
                                                            className="w-12 h-12 object-cover rounded"
                                                        />
                                                        <div className="flex-1">
                                                            <span className="text-xs font-medium px-2 py-0.5 rounded bg-blue-600/30 text-blue-400">
                                                                {input.label || `参考图${index + 1}`}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : frameInputsWithUrls.length === 0 ? (
                                            <div className="text-xs text-neutral-600 italic py-2">
                                                请连接图片节点作为首帧和尾帧
                                            </div>
                                        ) : (
                                            /* Vertical draggable layout for Frame-to-Frame */
                                            <div className="space-y-2">
                                                {frameInputsWithUrls.map((input, index) => (
                                                    <div
                                                        key={input.nodeId}
                                                        draggable
                                                        onDragStart={() => setDraggedIndex(index)}
                                                        onDragOver={(e) => e.preventDefault()}
                                                        onDrop={() => {
                                                            if (draggedIndex !== null) {
                                                                handleFrameReorder(draggedIndex, index);
                                                                setDraggedIndex(null);
                                                            }
                                                        }}
                                                        onDragEnd={() => setDraggedIndex(null)}
                                                        className={`flex items-center gap-2 p-2 bg-neutral-800 rounded-lg cursor-grab active:cursor-grabbing transition-all ${draggedIndex === index ? 'opacity-50 scale-95' : ''
                                                            }`}
                                                    >
                                                        <GripVertical size={14} className="text-neutral-600" />
                                                        <img
                                                            src={input.url}
                                                            alt={`Frame ${index + 1}`}
                                                            className="w-12 h-12 object-cover rounded"
                                                        />
                                                        <div className="flex-1">
                                                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${input.order === 'start'
                                                                ? 'bg-green-600/30 text-green-400'
                                                                : 'bg-orange-600/30 text-orange-400'
                                                                }`}>
                                                                {input.order === 'start' ? '首帧' : '尾帧'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {!useReferenceMaterials && connectedImageNodes.length > frameInputsWithUrls.length && (
                                            <div className="text-xs text-neutral-500 mt-1">
                                                还有 {connectedImageNodes.length - frameInputsWithUrls.length} 个输入可用
                                            </div>
                                        )}
                                        {referenceOnlyModel && (
                                            <div className="text-xs text-neutral-500 mt-1">
                                                该模型没有首帧/尾帧，连接的图片全部作为参考素材（最多 12 个）；
                                                提示词里按上面的名字引用，例如 @{referenceInputsWithUrls[0]?.label || '参考图1'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
            }
        </div >
    );
};

// Memoize to prevent re-renders when parent state changes
export const NodeControls = memo(NodeControlsComponent);
