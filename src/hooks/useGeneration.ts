/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { NodeData, NodeType, NodeStatus } from '../types';
import {
    createProductSceneJob,
    generateImage,
    generateImageBatch,
    generateVideo,
    queueCodexImage
} from '../services/generationService';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { createAdditionalImagePlacements } from '../utils/imageBatchLayout.js';
import { minimumReferenceImages, shouldUseReferenceImages } from '../utils/videoModelCapabilities.js';
import {
    collectNodeReferences,
    extractReferenceLabels,
    selectPromptReferences,
} from '../utils/nodeReferences.js';
import { inferProductSceneAspectRatio, validateProductDimensions } from '../../shared/productSceneReplacement.js';

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
    addNodes: (nodes: NodeData[]) => void;
    workflowId?: string | null;
}

export const useGeneration = ({ nodes, updateNode, addNodes, workflowId }: UseGenerationProps) => {
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
        if (!workflowId) {
            updateNode(id, { status: NodeStatus.ERROR, errorMessage: '请先新建或打开项目' });
            return;
        }
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
        const explicitReferenceLabels = extractReferenceLabels(combinedPrompt, directReferences);
        const selectedReferences = selectPromptReferences(directReferences, combinedPrompt);
        const selectedReferenceIds = new Set(selectedReferences.map(reference => reference.id));
        const shouldUseReferenceParent = (parentId: string) =>
            explicitReferenceLabels.size === 0 || selectedReferenceIds.has(parentId);
        if (!combinedPrompt && node.type !== NodeType.PRODUCT_SCENE_REPLACE) return;

        // 先在前端固定任务 ID。即使创建请求返回前页面刷新，恢复逻辑也能按同一 ID 找回任务。
        const requestedProductSceneJobId = node.type === NodeType.PRODUCT_SCENE_REPLACE
            ? crypto.randomUUID()
            : undefined;

        updateNode(id, {
            status: NodeStatus.LOADING,
            productSceneJobId: requestedProductSceneJobId,
            productSceneStage: node.type === NodeType.PRODUCT_SCENE_REPLACE ? 'analyzing' : undefined,
            productSceneJobStatus: node.type === NodeType.PRODUCT_SCENE_REPLACE ? 'pending' : undefined,
            productSceneStageLabel: node.type === NodeType.PRODUCT_SCENE_REPLACE ? '正在创建任务' : undefined,
            generationStartTime: Date.now(),
            codexJobId: undefined,
            codexJobStatus: undefined,
            errorMessage: undefined
        });

        try {
            if (node.type === NodeType.PRODUCT_SCENE_REPLACE) {
                const dimensions = node.productDimensions;
                const dimensionError = validateProductDimensions(dimensions);
                if (dimensionError) throw new Error(dimensionError);

                const sceneNode = nodes.find(parent => parent.id === node.sceneReferenceId);
                const productNode = nodes.find(parent => parent.id === node.productReferenceId);
                const sceneUrl = sceneNode?.resultUrl || sceneNode?.editorBackgroundUrl;
                const productUrl = productNode?.resultUrl || productNode?.editorBackgroundUrl;
                if (!sceneUrl || !productUrl) throw new Error('请连接并指定“场景参考”和“我方产品”两张图片');
                if (sceneNode?.id === productNode?.id) throw new Error('场景参考与我方产品不能使用同一张图片');
                const productAspectRatio = inferProductSceneAspectRatio(
                    node.aspectRatio,
                    inferProductSceneAspectRatio(sceneNode.resultAspectRatio || sceneNode.aspectRatio, '1:1')
                );
                const job = await createProductSceneJob({
                    jobId: requestedProductSceneJobId,
                    workflowId,
                    nodeId: id,
                    retryJobId: node.productSceneJobStatus === 'failed' ? node.productSceneJobId : undefined,
                    sceneImage: sceneUrl,
                    productImage: productUrl,
                    dimensions: dimensions!,
                    productCategory: node.productCategory,
                    preserveProductMarkings: node.preserveProductMarkings !== false,
                    personaBrief: node.personaBrief,
                    imageModel: node.imageModel || 'google-flow-nano-banana-pro',
                    aspectRatio: productAspectRatio,
                });
                updateNode(id, {
                    status: NodeStatus.LOADING,
                    aspectRatio: productAspectRatio,
                    productSceneJobId: job.id,
                    productSceneJobStatus: job.status,
                    productSceneStage: job.stage === 'generating' ? 'generating' : 'analyzing',
                    productSceneStageLabel: job.stageLabel,
                    productSceneRecognitionModel: `${job.recognitionProvider} · ${job.recognitionModel}`,
                    generationStartTime: Date.now(),
                    errorMessage: undefined,
                });
                return;
            } else if (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) {
                // Collect ALL parent images for multi-input generation
                const imageBase64s: string[] = [];
                // 即梦页面最多接收 12 张参考图；Gemini/Codex 现有链路允许 14 张。
                // 在遍历祖先时就按当前 provider 收口，避免即梦多参考图请求到后端才失败。
                const imageReferenceLimit = node.imageModel?.startsWith('jimeng-image-') ? 12 : 14;

                // Collect successful direct parents and all successful image ancestors.
                // A linear role workflow therefore keeps the original face identity image
                // in every downstream request instead of replacing it with only the
                // immediately preceding composite/full-body output.
                if (node.parentIds && node.parentIds.length > 0) {
                    const pendingParentIds = node.parentIds.filter(parentId => shouldUseReferenceParent(parentId));
                    const visitedParentIds = new Set<string>();
                    const addedUrls = new Set<string>();

                    while (pendingParentIds.length > 0 && imageBase64s.length < imageReferenceLimit) {
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
                            if (imageBase64s.length >= imageReferenceLimit) break;
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
                        if (
                            imageBase64s.length < imageReferenceLimit
                            && !imageBase64s.includes(charUrl)
                        ) {
                            imageBase64s.push(charUrl);
                        }
                    }
                }

                // Plus-only bridge: queue the request for interactive Codex image generation.
                // The recovery hook polls this job and applies the finished image automatically.
                if (node.imageModel === 'codex-imagegen') {
                    const job = await queueCodexImage({
                        workflowId,
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

                const isBrowserBatch =
                    node.imageModel?.startsWith('jimeng-image-') === true ||
                    node.imageModel?.startsWith('google-flow-') === true;
                const generationCount = isBrowserBatch
                    ? Math.min(4, Math.max(1, Number(node.imageGenerationCount) || 1))
                    : 1;

                if (isBrowserBatch) {
                    const connectedReferenceParentIds = directReferences
                        .filter(reference =>
                            (reference.kind === 'image' || reference.kind === 'video')
                            && Boolean(reference.previewUrl || reference.url)
                        )
                        .map(reference => reference.id);
                    const hasReferenceImages = imageBase64s.length > 0;
                    const rawResultUrls = await generateImageBatch({
                        workflowId,
                        prompt: combinedPrompt,
                        aspectRatio: node.aspectRatio,
                        resolution: node.resolution,
                        imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                        imageModel: node.imageModel,
                        nodeId: id,
                        count: generationCount
                    });
                    const generatedAt = Date.now();
                    const resultUrls = rawResultUrls.slice(0, 4).map(
                        (url, index) => `${url}${url.includes('?') ? '&' : '?'}t=${generatedAt}-${index}`
                    );
                    const firstImage = await getImageAspectRatio(resultUrls[0]);
                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl: resultUrls[0],
                        resultAspectRatio: firstImage.resultAspectRatio,
                        generationStartTime: undefined,
                        errorMessage: undefined
                    });

                    const additionalNodes = createAdditionalImagePlacements(
                        {
                            ...node,
                            resultAspectRatio: firstImage.resultAspectRatio
                        },
                        resultUrls,
                        hasReferenceImages
                            ? {
                                layout: 'vertical',
                                parentIds: connectedReferenceParentIds
                            }
                            : undefined
                    )
                        .map((placement, index): NodeData => ({
                            id: crypto.randomUUID(),
                            type: NodeType.IMAGE,
                            title: `${node.imageModel?.startsWith('google-flow-') ? 'Flow' : '即梦'}图片 ${index + 2}`,
                            x: placement.x,
                            y: placement.y,
                            prompt: combinedPrompt,
                            status: NodeStatus.SUCCESS,
                            resultUrl: placement.resultUrl,
                            resultAspectRatio: firstImage.resultAspectRatio,
                            parentIds: placement.parentIds,
                            model: node.model || 'Banana Pro',
                            imageModel: node.imageModel,
                            imageGenerationCount: generationCount,
                            aspectRatio: node.aspectRatio,
                            resolution: node.resolution
                        }));
                    if (additionalNodes.length > 0) addNodes(additionalNodes);
                    return;
                }

                // Generate one image for providers without native batch output.
                const rawResultUrl = await generateImage({
                    workflowId,
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
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
                    generationStartTime: undefined,
                    // Note: aspectRatio is intentionally NOT updated to preserve user's selection
                    errorMessage: undefined
                });


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
                    // 产品场景替换的控制节点没有 resultUrl，成图在它的子 Image 节点上，
                    // 计入这里会让「图片 + 控制节点」被误判成首尾帧插值且尾帧为空。
                    return parent && [NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.VIDEO, NodeType.VIDEO_EDITOR].includes(parent.type);
                }) || [];

                // Check for frame-to-frame mode (explicit or auto-detected from 2+ image parents)
                const hasMultipleInputs = imageParentIds.length >= 2;
                const hasExplicitFrameInputs = node.frameInputs && node.frameInputs.length >= 2;

                // 多参考图 / 参考素材：把所有连接的图片整体交给 workflow（--reference-image ×N），
                // 而不是当作首/尾帧插值。判定收敛在 videoModelCapabilities：
                //   Google Flow —— 连 1 张仍是首帧，≥2 张才走 Ingredients；
                //   即梦        —— 没有首帧概念，连 1 张就是参考素材。
                let videoReferenceImages: string[] | undefined;
                let videoReferenceLabels: string[] | undefined;
                // 图和它的名字必须来自**同一条有序列表**：节点面板显示的标签来自
                // collectNodeReferences，如果这里另起一份 imageParentIds 推导，
                // 两边顺序/子集一旦不同，提示词里的 @参考图2 就会指到别的图。
                const visualReferences = directReferences.filter(reference =>
                    (reference.kind === 'image' || reference.kind === 'video')
                    && shouldUseReferenceParent(reference.id)
                    && Boolean(reference.previewUrl || reference.url)
                );
                const useReferenceImages = shouldUseReferenceImages(node.videoModel, visualReferences.length);
                if (useReferenceImages) {
                    videoReferenceImages = visualReferences.map(reference => (reference.previewUrl || reference.url)!);
                    videoReferenceLabels = visualReferences.map(reference => reference.label);
                    const minimum = minimumReferenceImages(node.videoModel);
                    if (videoReferenceImages.length < minimum) {
                        throw new Error(`多参考图需要至少 ${minimum} 张已生成的图片，请检查连接的图片节点是否都已出图`);
                    }
                }

                const isFrameToFrame = !useReferenceImages && (node.videoMode === 'frame-to-frame' || hasMultipleInputs || hasExplicitFrameInputs);

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
                    // Standard mode: get first parent image or video last frame.
                    const parent = nodes.find(n => n.id === imageParentIds[0]);

                    if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                        imageBase64 = parent.lastFrame;
                    } else if (parent?.resultUrl) {
                        imageBase64 = parent.resultUrl;
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
                    workflowId,
                    prompt: videoPrompt,
                    imageBase64,
                    lastFrameBase64,
                    referenceImages: videoReferenceImages,
                    referenceImageLabels: videoReferenceLabels,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    duration: node.videoDuration,
                    videoModel: node.videoModel,
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
                    generationStartTime: undefined,
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
                productSceneStage: undefined,
                productSceneJobStatus: node.type === NodeType.PRODUCT_SCENE_REPLACE ? 'failed' : undefined,
                productSceneStageLabel: node.type === NodeType.PRODUCT_SCENE_REPLACE ? '任务创建失败' : undefined,
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
