/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { NodeData, NodeType, NodeStatus } from '../types';
import { generateImage, generateVideo, queueCodexImage } from '../services/generationService';
import { generateLocalImage } from '../services/localModelService';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import {
    collectNodeReferences,
    extractReferenceLabels,
    selectPromptReferences,
} from '../utils/nodeReferences.js';

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGeneration = ({ nodes, updateNode }: UseGenerationProps) => {
    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Convert pixel dimensions to closest standard aspect ratio
     */
    const getClosestAspectRatio = (width: number, height: number): string => {
        const ratio = width / height;
        const standardRatios = [
            { label: '1:1', value: 1 },
            { label: '16:9', value: 16 / 9 },
            { label: '9:16', value: 9 / 16 },
            { label: '4:3', value: 4 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '5:4', value: 5 / 4 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 }
        ];

        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of standardRatios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.label;
    };

    /**
     * Detect the actual aspect ratio of an image
     * @param imageUrl - URL or base64 of the image
     * @returns Promise with resultAspectRatio (exact) and aspectRatio (closest standard)
     */
    const getImageAspectRatio = (imageUrl: string): Promise<{ resultAspectRatio: string; aspectRatio: string }> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
                resolve({ resultAspectRatio, aspectRatio });
            };
            img.onerror = () => {
                resolve({ resultAspectRatio: '16/9', aspectRatio: '16:9' });
            };
            img.src = imageUrl;
        });
    };

    // ============================================================================
    // GENERATION HANDLER
    // ============================================================================

    /**
     * Handles content generation for a node
     * Supports image and video generation with parent node chaining
     * 
     * @param id - ID of the node to generate content for
     */
    const handleGenerate = async (id: string) => {
        const node = nodes.find(n => n.id === id);
        if (!node) return;

        // Get prompts from connected TEXT nodes (if any)
        const getTextNodePrompts = (): string[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => nodes.find(n => n.id === pid))
                .filter(n => n?.type === NodeType.TEXT && n.prompt)
                .map(n => n!.prompt);
        };

        // Combine prompts: TEXT node prompts + node's own prompt
        const textNodePrompts = getTextNodePrompts();
        const combinedPrompt = [...textNodePrompts, node.prompt].filter(Boolean).join('\n\n');
        const directReferences = collectNodeReferences(node.parentIds, nodes);
        const explicitReferenceLabels = extractReferenceLabels(combinedPrompt);
        const selectedReferences = selectPromptReferences(directReferences, combinedPrompt);
        const selectedReferenceIds = new Set(selectedReferences.map(reference => reference.id));
        const shouldUseReferenceParent = (parentId: string) =>
            explicitReferenceLabels.size === 0 || selectedReferenceIds.has(parentId);
        const selectedVisualReferences = selectedReferences.filter(reference => reference.kind !== 'audio');

        // Check if prompt is required
        // For Kling frame-to-frame with both start and end frames, prompt is optional
        const isKlingFrameToFrame =
            node.type === NodeType.VIDEO &&
            node.videoModel?.startsWith('kling-') &&
            selectedVisualReferences.length >= 2;

        if (!combinedPrompt && !isKlingFrameToFrame) return;

        updateNode(id, {
            status: NodeStatus.LOADING,
            generationStartTime: Date.now(),
            codexJobId: undefined,
            codexJobStatus: undefined,
            errorMessage: undefined
        });

        try {
            if (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) {
                // Collect ALL parent images for multi-input generation
                const imageBase64s: string[] = [];

                // Collect successful direct parents and all successful image ancestors.
                // A linear role workflow therefore keeps the original face identity image
                // in every downstream request instead of replacing it with only the
                // immediately preceding composite/full-body output.
                if (node.parentIds && node.parentIds.length > 0) {
                    const pendingParentIds = node.parentIds.filter(parentId => shouldUseReferenceParent(parentId));
                    const visitedParentIds = new Set<string>();
                    const addedUrls = new Set<string>();

                    while (pendingParentIds.length > 0 && imageBase64s.length < 14) {
                        const parentId = pendingParentIds.shift()!;
                        if (visitedParentIds.has(parentId)) continue;
                        visitedParentIds.add(parentId);

                        const parent = nodes.find(n => n.id === parentId);
                        if (!parent || parent.type === NodeType.TEXT) continue;

                        const parentReferenceUrl = parent.type === NodeType.VIDEO
                            ? (parent.lastFrame || parent.resultUrl)
                            : parent.resultUrl;
                        if (parentReferenceUrl && !addedUrls.has(parentReferenceUrl)) {
                            imageBase64s.push(parentReferenceUrl);
                            addedUrls.add(parentReferenceUrl);
                        }

                        // Character-library assets carry their identity face and look-pack
                        // references. Propagate those references to downstream generation
                        // nodes so connecting one look asset is enough to lock both face
                        // identity and wardrobe consistency.
                        for (const characterUrl of parent.characterReferenceUrls || []) {
                            if (imageBase64s.length >= 14) break;
                            if (!addedUrls.has(characterUrl)) {
                                imageBase64s.push(characterUrl);
                                addedUrls.add(characterUrl);
                            }
                        }

                        for (const ancestorId of parent.parentIds || []) {
                            if (!visitedParentIds.has(ancestorId)) {
                                pendingParentIds.push(ancestorId);
                            }
                        }
                    }
                }

                // Add character reference URLs from storyboard nodes (for maintaining character consistency)
                if (node.characterReferenceUrls && node.characterReferenceUrls.length > 0) {
                    for (const charUrl of node.characterReferenceUrls) {
                        if (imageBase64s.length < 14 && !imageBase64s.includes(charUrl)) { // Respect Gemini's limit
                            imageBase64s.push(charUrl);
                        }
                    }
                }

                // Plus-only bridge: queue the request for interactive Codex image generation.
                // The recovery hook polls this job and applies the finished image automatically.
                if (node.imageModel === 'codex-imagegen') {
                    const job = await queueCodexImage({
                        nodeId: id,
                        prompt: combinedPrompt,
                        aspectRatio: node.aspectRatio,
                        resolution: node.resolution,
                        referenceImages: imageBase64s.length > 0 ? imageBase64s : undefined
                    });
                    updateNode(id, {
                        status: NodeStatus.LOADING,
                        codexJobId: job.id,
                        codexJobStatus: job.status,
                        generationStartTime: Date.now(),
                        errorMessage: undefined
                    });
                    return;
                }

                // Generate image with all parent images and character references
                const rawResultUrl = await generateImage({
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
                    // Kling V1.5 reference settings
                    klingReferenceMode: node.klingReferenceMode,
                    klingFaceIntensity: node.klingFaceIntensity,
                    klingSubjectIntensity: node.klingSubjectIntensity
                });

                // Add cache-busting parameter to force browser to fetch new image
                // (Backend uses nodeId as filename, so URL is the same for regenerated images)
                const resultUrl = `${rawResultUrl}?t=${Date.now()}`;

                // Detect actual image dimensions (for display purposes only)
                const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                // Keep user's selected aspectRatio - don't overwrite it with detected ratio
                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    // Note: aspectRatio is intentionally NOT updated to preserve user's selection
                    errorMessage: undefined
                });


            } else if (node.type === NodeType.LOCAL_IMAGE_MODEL) {
                // --- LOCAL MODEL GENERATION ---
                // Check if model is selected
                if (!node.localModelId && !node.localModelPath) {
                    updateNode(id, {
                        status: NodeStatus.ERROR,
                        errorMessage: 'No local model selected. Please select a model first.'
                    });
                    return;
                }

                // Get parent images if any
                const imageBase64s: string[] = [];
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds.filter(parentId => shouldUseReferenceParent(parentId))) {
                        const parent = nodes.find(n => n.id === parentId);
                        const parentReferenceUrl = parent?.type === NodeType.VIDEO
                            ? (parent.lastFrame || parent.resultUrl)
                            : parent?.resultUrl;
                        if (parent?.type !== NodeType.TEXT && parentReferenceUrl) {
                            imageBase64s.push(parentReferenceUrl);
                        }
                    }
                }

                // Call local generation API
                const result = await generateLocalImage({
                    modelId: node.localModelId,
                    modelPath: node.localModelPath,
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution || '512'
                });

                if (result.success && result.resultUrl) {
                    // Add cache-busting parameter
                    const resultUrl = `${result.resultUrl}?t=${Date.now()}`;

                    // Detect actual image dimensions
                    const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        resultAspectRatio,
                        errorMessage: undefined
                    });
                } else {
                    throw new Error(result.error || 'Local generation failed');
                }

            } else if (node.type === NodeType.VIDEO) {
                // Get first parent image for video generation (start frame)
                let imageBase64: string | undefined;
                let lastFrameBase64: string | undefined;

                const isSeedanceModel = !!node.videoModel?.startsWith('seedance-');
                const supportsSeedanceReferenceAudio = node.videoModel === 'seedance-2-0' || node.videoModel === 'seedance-2-0-fast';
                const connectedSeedanceAudioUrls = isSeedanceModel
                    ? (node.parentIds || [])
                        .filter(parentId => shouldUseReferenceParent(parentId))
                        .map(parentId => nodes.find(n => n.id === parentId))
                        .filter(parent => parent?.type === NodeType.AUDIO && parent.mediaUrl)
                        .map(parent => parent!.mediaUrl!)
                        .slice(0, 3)
                    : [];
                if (connectedSeedanceAudioUrls.length > 0 && !supportsSeedanceReferenceAudio) {
                    throw new Error('输入音色参考仅支持 Seedance 2.0 与 Seedance 2.0 Fast，请切换模型或移除音频连接');
                }
                const referenceAudioUrls = supportsSeedanceReferenceAudio ? connectedSeedanceAudioUrls : [];

                // Only visual parents participate in first/last-frame selection.
                // Connected AUDIO nodes are handled separately as Seedance references.
                const imageParentIds = node.parentIds?.filter(pid => {
                    if (!shouldUseReferenceParent(pid)) return false;
                    const parent = nodes.find(n => n.id === pid);
                    return parent && [NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.VIDEO, NodeType.VIDEO_EDITOR].includes(parent.type);
                }) || [];

                // Check for frame-to-frame mode (explicit or auto-detected from 2+ image parents)
                const hasMultipleInputs = imageParentIds.length >= 2;
                const hasExplicitFrameInputs = node.frameInputs && node.frameInputs.length >= 2;

                // Motion Reference logic (Kling 2.6)
                let motionReferenceUrl: string | undefined;
                let isMotionControl = false;
                if (node.videoModel === 'kling-v2-6') {
                    // Find a parent video node that has a result
                    const videoParent = node.parentIds
                        ?.filter(parentId => shouldUseReferenceParent(parentId))
                        ?.map(pid => nodes.find(n => n.id === pid))
                        .find(n => n?.type === NodeType.VIDEO && n.resultUrl);

                    if (videoParent) {
                        motionReferenceUrl = videoParent.resultUrl;
                        isMotionControl = true;
                    }
                }

                // Only evaluate as frame-to-frame if NOT in motion control mode
                const isFrameToFrame = !isMotionControl && (node.videoMode === 'frame-to-frame' || hasMultipleInputs || hasExplicitFrameInputs);

                if (isFrameToFrame && imageParentIds.length >= 2) {
                    // Get start and end frames from frameInputs (if user reordered) or default order
                    const parent1 = nodes.find(n => n.id === imageParentIds[0]);
                    const parent2 = nodes.find(n => n.id === imageParentIds[1]);

                    // Check if user has explicitly set frame order
                    if (node.frameInputs && node.frameInputs.length >= 2) {
                        const startFrameInput = node.frameInputs.find(f => f.order === 'start');
                        const endFrameInput = node.frameInputs.find(f => f.order === 'end');

                        if (startFrameInput) {
                            const startNode = nodes.find(n => n.id === startFrameInput.nodeId);
                            if (startNode?.resultUrl) {
                                imageBase64 = startNode.resultUrl;
                            }
                        }

                        if (endFrameInput) {
                            const endNode = nodes.find(n => n.id === endFrameInput.nodeId);
                            if (endNode?.resultUrl) {
                                lastFrameBase64 = endNode.resultUrl;
                            }
                        }
                    } else {
                        // Default: first parent = start, second parent = end
                        if (parent1?.resultUrl) imageBase64 = parent1.resultUrl;
                        if (parent2?.resultUrl) lastFrameBase64 = parent2.resultUrl;
                    }
                } else if (imageParentIds.length > 0) {
                    // Standard mode or Motion Control: get character reference or first parent image
                    if (isMotionControl) {
                        // For Motion Control, look specifically for an IMAGE parent as character reference
                        const characterParent = node.parentIds
                            ?.filter(parentId => shouldUseReferenceParent(parentId))
                            ?.map(pid => nodes.find(n => n.id === pid))
                            .find(n => n?.type === NodeType.IMAGE && n.resultUrl);

                        if (characterParent?.resultUrl) {
                            imageBase64 = characterParent.resultUrl;
                        }
                    } else {
                        // Standard mode: get first parent image or video last frame
                        // Use imageParentIds (filtered to exclude TEXT nodes) instead of raw parentIds
                        const parent = nodes.find(n => n.id === imageParentIds[0]);

                        if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                            // Use last frame from parent video
                            imageBase64 = parent.lastFrame;
                        } else if (parent?.resultUrl) {
                            // Use parent image directly
                            imageBase64 = parent.resultUrl;
                        }
                    }
                }

                // Generate video
                if (referenceAudioUrls.length > 0 && lastFrameBase64) {
                    throw new Error('Seedance 音色参考不能与尾帧模式同时使用：请移除尾帧，只保留首帧');
                }
                const videoPrompt = referenceAudioUrls.length > 0
                    ? `${combinedPrompt}\n\n音色控制：@音频1只作为人物固定音色参考，不复述参考音频中的原始台词。保持相同音色、年龄感、口音和自然说话方式；本镜头只说上文指定的台词，并按本次台词生成准确口型。不要新增旁白或背景音乐。`
                    : combinedPrompt;
                const rawResultUrl = await generateVideo({
                    prompt: videoPrompt,
                    imageBase64,
                    lastFrameBase64,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    duration: node.videoDuration,
                    videoModel: node.videoModel,
                    motionReferenceUrl,
                    referenceAudioUrls,
                    generateAudio: true, // 支持原生音频的视频模型固定生成音频
                    nodeId: id
                });

                // Add cache-busting parameter to force browser to fetch new video
                // (Backend uses nodeId as filename, so URL is the same for regenerated videos)
                const resultUrl = `${rawResultUrl}?t=${Date.now()}`;

                // Extract last frame for chaining
                const lastFrame = await extractVideoLastFrame(resultUrl);

                // Detect video aspect ratio
                let resultAspectRatio: string | undefined;
                let aspectRatio: string | undefined;
                try {
                    const video = document.createElement('video');
                    await new Promise<void>((resolve) => {
                        video.onloadedmetadata = () => {
                            resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
                            aspectRatio = getClosestAspectRatio(video.videoWidth, video.videoHeight);
                            resolve();
                        };
                        video.onerror = () => resolve();
                        video.src = resultUrl;
                    });
                } catch (e) {
                    // Ignore errors, use undefined aspect ratio
                }

                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    aspectRatio,
                    lastFrame,
                    errorMessage: undefined // Clear any previous error
                });


            }
        } catch (error: any) {
            // Handle errors
            const msg = error.toString().toLowerCase();
            let errorMessage = error.message || 'Generation failed';

            if (msg.includes('permission_denied') || msg.includes('403')) {
                errorMessage = 'Permission denied. Check API Key configuration.';
            } else if (msg.includes('unable to process input image') || msg.includes('invalid_argument')) {
                errorMessage = '⚠️ Input image incompatible. Veo requires: JPEG format, 16:9 or 9:16 aspect ratio. Try a different image or generate without input.';
            }

            updateNode(id, {
                status: node.resultUrl ? NodeStatus.SUCCESS : NodeStatus.ERROR,
                errorMessage,
                codexJobId: undefined,
                codexJobStatus: undefined
                // generationStartTime 不清空：App.tsx 的 waitForNodeResult 靠它跟 before 快照对比
                // 判断"是否发生了新一轮生成"。首次生成（before.generationStartTime 本来就是
                // undefined）失败时如果这里也置 undefined，前后一致会被误判成"没有新尝试"，
                // 导致 waitForNodeResult 一直等不到 ERROR 状态、卡住整整一小时超时——
                // 期间 generationPromisesRef 里的 promise 不会清掉，点重新生成/运行没有任何反应。
            });
            console.error('Generation failed:', error);
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleGenerate
    };
};
