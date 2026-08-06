/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Seedance, Web HTTP workflows, and OpenAI GPT Image providers.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateGeminiImage, generateVeoVideo } from '../services/gemini.js';
import { generateSeedanceVideo } from '../services/seedance.js';
import {
    generateGoogleFlowWorkflowVideo,
    isGoogleFlowWorkflowModelId,
    resolveGoogleFlowWorkflowVideoInputs
} from '../services/googleFlowWorkflow.js';
import { generateJimengWorkflowVideo, isJimengWorkflowModelId, resolveJimengModelLabel } from '../services/jimengVideoWorkflow.js';
import { generateGoogleFlowWorkflowImage, isGoogleFlowImageWorkflowModel } from '../services/googleFlowImageWorkflow.js';
import { generateJimengWorkflowImage, isJimengImageWorkflowModel } from '../services/jimengImageWorkflow.js';
import { generateOpenAIImage } from '../services/openai.js';
import { resolveAudioToBase64, resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import { cancelProductSceneJob, createProductSceneJob, dismissProductSceneResultNodes, getLatestProductSceneJob, getProductSceneJob } from '../services/productSceneJobs.js';
import {
    generateGeminiWebImage,
    generateGeminiWebVideo,
    isGeminiWebImageModel,
    isGeminiWebVideoModel
} from '../services/geminiWebWorkflow.js';
import {
    getImageGenerationProvider,
    getVideoGenerationProvider,
    normalizeImageResolution
} from '../../shared/generationProviders.js';
import { resolveWebExecutionMode } from '../services/webhttp/index.js';
import { cancelGeneration, isGenerationActive, registerGeneration } from '../services/generationCancellation.js';
import { generationHasCrossedSubmissionBoundary } from '../services/generationRuntime/scheduler.js';

const router = express.Router();

/**
 * 画布模型 id → Web HTTP provider id。
 *
 * 只用于查执行模式（auto / http / browser），协议模型 id 的映射在
 * services/webhttp/registry.js 里，两者刻意分开。
 */
function webProviderForModel(modelId) {
    const id = String(modelId || '');
    if (id.startsWith('gemini-web-')) return 'gemini-web';
    if (id.startsWith('jimeng-')) return 'jimeng';
    if (id.startsWith('google-flow-')) return 'google-flow';
    return null;
}

function executionModeFor(app, modelId) {
    const provider = webProviderForModel(modelId);
    return provider ? resolveWebExecutionMode(app, provider) : undefined;
}

function sendGenerationError(res, error, fallbackMessage) {
    const code = typeof error?.code === 'string' ? error.code : undefined;
    const status = code === 'INVALID_INPUT' ? 400
        : code === 'AUTH_EXPIRED' ? 401
            : code === 'WAF_BLOCKED' ? 403
                : code === 'RATE_LIMIT' || code === 'QUOTA_EXHAUSTED' ? 429
                    : code === 'CONTENT_POLICY' ? 422
                        : 500;
    return res.status(status).json({
        error: error?.message || fallbackMessage,
        ...(code ? { code } : {}),
        ...(typeof error?.submitted === 'boolean' ? { submitted: error.submitted } : {}),
        ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        ...(error?.details && typeof error.details === 'object' ? { details: error.details } : {})
    });
}

const productSceneContext = appLocals => ({
    dirs: {
        workflowsDir: appLocals.WORKFLOWS_DIR,
        projectsDir: appLocals.PROJECTS_DIR
    },
    libraryDir: appLocals.LIBRARY_DIR,
    codexJobsDir: appLocals.CODEX_IMAGE_JOBS_DIR,
    codexAutomation: appLocals.CODEX_IMAGE_AUTOMATION,
    arkApiKey: appLocals.ARK_API_KEY,
    recognitionModel: appLocals.PROMPT_OPTIMIZER_PROVIDER === 'codex-cli'
        ? (appLocals.PROMPT_OPTIMIZER_MODEL || 'gpt-5.6-luna')
        : 'gpt-5.6-luna'
});

router.post('/product-scene-jobs', (req, res) => {
    try {
        const usesCodexRecognition = req.body?.recognitionProvider !== 'gemini-web';
        const usesCodexImage = req.body?.imageModel === 'codex-imagegen';
        const codexStatus = req.app.locals.CODEX_INTEGRATION?.getStatus();
        if ((usesCodexRecognition || usesCodexImage) && (!codexStatus?.available || !codexStatus.authenticated)) {
            return res.status(codexStatus?.available ? 401 : 503).json({
                error: codexStatus?.available
                    ? 'Codex 尚未登录，请先在设置 → Codex 服务中登录 ChatGPT'
                    : '未检测到 Codex CLI，请先在设置 → Codex 服务中完成配置'
            });
        }
        const job = createProductSceneJob(req.body || {}, productSceneContext(req.app.locals));
        return res.status(202).json(job);
    } catch (error) {
        return res.status(400).json({ error: error.message || '无法创建产品场景替换任务' });
    }
});

router.post('/product-scene-jobs/:jobId/cancel', (req, res) => {
    try {
        const workflowId = String(req.body?.workflowId || '');
        if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
        const job = cancelProductSceneJob(req.params.jobId, workflowId, productSceneContext(req.app.locals));
        if (!job) return res.status(404).json({ error: '产品短视频任务不存在' });
        return res.json(job);
    } catch (error) {
        return res.status(400).json({ error: error.message || '取消任务失败' });
    }
});

// 用户删掉结果节点后调这里；不记这一笔的话，画布恢复逻辑会把它当成「结果还在但节点
// 丢了」，下一轮就原样长回来。
router.post('/product-scene-jobs/dismiss-results', (req, res) => {
    try {
        const workflowId = String(req.body?.workflowId || '');
        if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
        const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.map(String) : [];
        return res.json(dismissProductSceneResultNodes(nodeIds, workflowId, productSceneContext(req.app.locals)));
    } catch (error) {
        return res.status(500).json({ error: error.message || '标记结果节点删除失败' });
    }
});

router.get('/product-scene-jobs/latest', (req, res) => {
    try {
        const workflowId = String(req.query.workflowId || '');
        const nodeId = String(req.query.nodeId || '');
        if (!workflowId || !nodeId) return res.status(400).json({ error: '缺少 workflowId 或 nodeId' });
        const job = getLatestProductSceneJob(nodeId, workflowId, productSceneContext(req.app.locals));
        if (!job) return res.status(404).json({ error: '该节点尚无产品场景替换任务' });
        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: error.message || '读取最新产品场景替换任务失败' });
    }
});

router.get('/product-scene-jobs/:jobId', (req, res) => {
    try {
        const workflowId = String(req.query.workflowId || '');
        if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
        const job = getProductSceneJob(req.params.jobId, workflowId, productSceneContext(req.app.locals));
        if (!job) return res.status(404).json({ error: '产品场景替换任务不存在' });
        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: error.message || '读取产品场景替换任务失败' });
    }
});

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', async (req, res) => {
    // 取消登记：视频/图片生成可能跑很久，用户必须能中止。signal 会一路透传到
    // 调度器和各 provider workflow（它们本来就支持），这里只负责持有 controller。
    let cancellation = null;
    try {
        const {
            nodeId,
            workflowId,
            prompt,
            aspectRatio,
            resolution,
            imageBase64: rawImageBase64,
            imageModel,
            count: rawCount
        } = req.body;
        const { GEMINI_API_KEY, OPENAI_API_KEY, LIBRARY_DIR, WORKFLOWS_DIR, PROJECTS_DIR } = req.app.locals;
        const { targetDir, urlPrefix } = resolveProjectMediaTarget(workflowId, 'images', {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });
        cancellation = registerGeneration({
            workflowId,
            nodeId,
            label: '图片生成',
            // 越过提交边界之后，取消已经无法阻止计费，取消端点要据此如实提示用户。
            submitted: () => generationHasCrossedSubmissionBoundary(
                webProviderForModel(imageModel),
                { workflowId, nodeId }
            )
        });

        if (imageModel?.startsWith('kling-')) {
            return res.status(400).json({ error: '该图片模型已下线，请切换为 Codex、Google Flow、Gemini 或 OpenAI 图片模型' });
        }

        // Determine provider
        const isOpenAIModel = imageModel && imageModel.startsWith('gpt-image-');
        const isGoogleFlowWorkflowModel = isGoogleFlowImageWorkflowModel(imageModel);
        const isJimengWorkflowModel = isJimengImageWorkflowModel(imageModel);
        const isGeminiWebWorkflowModel = isGeminiWebImageModel(imageModel);
        const isBrowserImageWorkflowModel = isJimengWorkflowModel
            || isGoogleFlowWorkflowModel
            || isGeminiWebWorkflowModel;
        const imageProvider = isBrowserImageWorkflowModel
            ? getImageGenerationProvider(imageModel)
            : null;
        const requestedImageResolution = isGoogleFlowWorkflowModel
            ? normalizeImageResolution(imageModel, resolution)
            : resolution || '2K';
        const requestedCount = rawCount === undefined ? 1 : Number(rawCount);
        if (!Number.isInteger(requestedCount) || requestedCount < 1) {
            return res.status(400).json({ error: '图片生成数量必须是正整数' });
        }
        if (isBrowserImageWorkflowModel && !imageProvider) {
            return res.status(400).json({ error: '当前图片模型没有可用的能力配置' });
        }
        const storedResolution = String(resolution || '').trim();
        const automaticResolution = !storedResolution
            || ['auto', '自动'].includes(storedResolution.toLowerCase());
        if (imageProvider && !automaticResolution
            && !imageProvider.resolutions.some(option =>
                option.toLowerCase() === storedResolution.toLowerCase())) {
            return res.status(400).json({
                error: `${imageProvider.name} 不支持 ${storedResolution}；支持 ${imageProvider.resolutions.join('/')}`
            });
        }
        if (imageProvider && requestedCount > imageProvider.maxOutputCount) {
            return res.status(400).json({
                error: `${imageProvider.name} 单次最多生成 ${imageProvider.maxOutputCount} 张图片`
            });
        }
        if (!isBrowserImageWorkflowModel && requestedCount !== 1) {
            return res.status(400).json({ error: '当前图片模型暂不支持单次多图生成' });
        }

        let imageBuffer;
        let imageFormat = 'png';
        let workflowImages = null;

        if (isGoogleFlowWorkflowModel || isJimengWorkflowModel || isGeminiWebWorkflowModel) {
            // --- WEB HTTP TEXT/REFERENCE-TO-IMAGE (FLOW / 即梦 / GEMINI WEB) ---
            const referenceImages = rawImageBase64
                ? (Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64]).filter(Boolean)
                : [];
            if (imageProvider && referenceImages.length > imageProvider.maxReferenceImages) {
                return res.status(400).json({
                    error: `${imageProvider.name} 最多支持 ${imageProvider.maxReferenceImages} 张参考图`
                });
            }

            console.log(`Using Web HTTP workflow for image: ${imageModel}`);
            const workflow = isJimengWorkflowModel
                ? generateJimengWorkflowImage
                : isGeminiWebWorkflowModel
                    ? generateGeminiWebImage
                    : generateGoogleFlowWorkflowImage;
            const result = await workflow({
                prompt,
                aspectRatio: aspectRatio || '1:1',
                resolution: requestedImageResolution,
                referenceImageInputs: referenceImages,
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 10,
                modelId: imageModel,
                count: requestedCount,
                nodeId,
                workflowId,
                signal: cancellation?.signal,
                executionMode: executionModeFor(req.app, imageModel)
            });
            workflowImages = result.images;
        } else if (isOpenAIModel) {
            // --- OPENAI GPT IMAGE GENERATION ---
            if (!OPENAI_API_KEY) {
                return res.status(500).json({
                    error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env"
                });
            }

            console.log(`Using OpenAI GPT Image model: ${imageModel}`);

            // Resolve images if provided
            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            imageBuffer = await generateOpenAIImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                apiKey: OPENAI_API_KEY
            });

        } else {
            // --- GEMINI IMAGE GENERATION (Default) ---
            if (!GEMINI_API_KEY) {
                return res.status(500).json({ error: "Server missing API Key config" });
            }

            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            imageBuffer = await generateGeminiImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                apiKey: GEMINI_API_KEY
            });
        }

        const generatedImages = workflowImages || [{ buffer: imageBuffer, extension: imageFormat }];
        const resultMetadata = [];
        const resultUrls = generatedImages.map((image, index) => {
            const saved = saveBufferToFile(image.buffer, targetDir, 'img', image.extension || 'png');
            const resultUrl = `${urlPrefix}/${saved.filename}`;
            const metadataId = index === 0 && nodeId
                ? nodeId
                : nodeId
                    ? `${nodeId}-${index + 1}-${saved.id}`
                    : saved.id;
            const providerMetadata = image.metadata || {};
            const requestedResolution = providerMetadata.requestedResolution || requestedImageResolution;
            const deliveredResolution = providerMetadata.deliveredResolution || requestedResolution;
            const metadata = {
                id: metadataId,
                filename: saved.filename,
                prompt,
                model: imageModel || 'gemini-pro',
                aspectRatio: aspectRatio || '1:1',
                ...(requestedResolution ? {
                    resolution: deliveredResolution,
                    requestedResolution
                } : {}),
                ...(Number.isInteger(providerMetadata.actualWidth) ? {
                    actualWidth: providerMetadata.actualWidth
                } : {}),
                ...(Number.isInteger(providerMetadata.actualHeight) ? {
                    actualHeight: providerMetadata.actualHeight
                } : {}),
                ...(providerMetadata.sourceMediaId ? {
                    flowSourceMediaId: providerMetadata.sourceMediaId
                } : {}),
                ...(providerMetadata.finalMediaId ? {
                    flowMediaId: providerMetadata.finalMediaId
                } : {}),
                ...(providerMetadata.downloadProtocol ? {
                    flowDownloadProtocol: providerMetadata.downloadProtocol
                } : {}),
                ...(providerMetadata.resolutionFallbackReason ? {
                    resolutionFallbackReason: providerMetadata.resolutionFallbackReason
                } : {}),
                batchIndex: index,
                batchCount: generatedImages.length,
                createdAt: new Date().toISOString(),
                type: 'images'
            };
            fs.writeFileSync(
                path.join(targetDir, `${metadataId}.json`),
                JSON.stringify(metadata, null, 2)
            );
            resultMetadata.push(metadata);
            return resultUrl;
        });

        console.log(
            `${resultUrls.length} image(s) saved (model: ${imageModel || 'gemini-pro'})`
        );
        return res.json({ resultUrl: resultUrls[0], resultUrls, resultMetadata });

    } catch (error) {
        console.error("Server Image Gen Error:", error);
        return sendGenerationError(res, error, 'Image generation failed');
    } finally {
        cancellation?.release();
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', async (req, res) => {
    let cancellation = null;
    try {
        const { nodeId, workflowId, prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64, referenceImages: rawReferenceImages, referenceVideo: rawReferenceVideo, referenceImageLabels: rawReferenceImageLabels, referenceAudioUrls: rawReferenceAudioUrls, aspectRatio, resolution, duration, videoModel } = req.body;
        const { GEMINI_API_KEY, ARK_API_KEY, LIBRARY_DIR, WORKFLOWS_DIR, PROJECTS_DIR } = req.app.locals;
        const { targetDir, urlPrefix } = resolveProjectMediaTarget(workflowId, 'videos', {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });
        cancellation = registerGeneration({
            workflowId,
            nodeId,
            label: '视频生成',
            submitted: () => generationHasCrossedSubmissionBoundary(
                webProviderForModel(videoModel),
                { workflowId, nodeId }
            )
        });

        // 旧项目里的已下线模型不能静默回落到 Veo，避免误扣其他供应商额度。
        if (videoModel?.startsWith('kling-') || videoModel?.startsWith('hailuo-')) {
            return res.status(400).json({ error: '该视频模型已下线，请切换为即梦、Google Flow 或 Seedance' });
        }

        // Determine provider
        const isSeedanceModel = videoModel && videoModel.startsWith('seedance-');
        const isGoogleFlowWorkflowModel = isGoogleFlowWorkflowModelId(videoModel);
        const isJimengWorkflowModel = isJimengWorkflowModelId(videoModel);
        const isGeminiWebWorkflowModel = isGeminiWebVideoModel(videoModel);
        const videoProvider = getVideoGenerationProvider(videoModel);
        const explicitReferences = Array.isArray(rawReferenceImages)
            ? rawReferenceImages.filter(Boolean)
            : [];
        const providedVisualCount = explicitReferences.length > 0
            ? explicitReferences.length
            : [rawImageBase64, rawLastFrameBase64].filter(Boolean).length;
        if (videoProvider && providedVisualCount > videoProvider.maxReferenceImages) {
            return res.status(400).json({
                error: `${videoProvider.name} 最多支持 ${videoProvider.maxReferenceImages} 张参考图`
            });
        }
        // 三个平台都走系统共享 Chrome workflow：输入是真实文件路径而非 base64。
        const isBrowserWorkflowModel = isGoogleFlowWorkflowModel || isJimengWorkflowModel || isGeminiWebWorkflowModel;

        // 页面 workflow 需要真实首帧路径；其他供应商继续使用 base64 输入。
        const imageBase64 = isBrowserWorkflowModel ? null : resolveImageToBase64(rawImageBase64);
        const lastFrameBase64 = isBrowserWorkflowModel ? null : resolveImageToBase64(rawLastFrameBase64);
        const referenceAudioUrls = isBrowserWorkflowModel
            ? []
            : (Array.isArray(rawReferenceAudioUrls) ? rawReferenceAudioUrls : [])
                .slice(0, 3)
                .map(resolveAudioToBase64)
                .filter(Boolean);

        let videoBuffer;
        let videoExtension = 'mp4';
        let workflowRunId;

        if (isGeminiWebWorkflowModel) {
            const referenceImageInputs = Array.isArray(rawReferenceImages)
                ? rawReferenceImages.filter(Boolean)
                : rawImageBase64 ? [rawImageBase64] : [];
            const workflowResult = await generateGeminiWebVideo({
                prompt,
                referenceImageInputs,
                aspectRatio: aspectRatio || '16:9',
                duration: duration || videoProvider?.supportedDurations?.[0] || 10,
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15,
                cameraMovement: req.body.cameraMovement || '',
                nativeAudio: req.body.generateAudio !== false,
                nodeId,
                workflowId,
                signal: cancellation?.signal,
                executionMode: executionModeFor(req.app, videoModel)
            });
            videoBuffer = workflowResult.buffer;
            videoExtension = workflowResult.extension;
            workflowRunId = workflowResult.runId;
        } else if (isGoogleFlowWorkflowModel) {
            if (rawReferenceVideo && videoModel !== 'google-flow-omni-flash') {
                return res.status(400).json({ error: 'Google Flow 参考视频当前只支持 Omni Flash' });
            }
            // Remix 会给人物/场景/道具参考图附资产标签。带资产标签的单图也必须走
            // Ingredients，不能把人物正面照误当成视频首帧；普通画布的无标签单图仍是首帧。
            const flowInputs = rawReferenceVideo ? {
                firstFrameInput: null,
                referenceImageInputs: []
            } : resolveGoogleFlowWorkflowVideoInputs({
                firstFrameInput: rawImageBase64,
                referenceImageInputs: explicitReferences,
                referenceImageLabels: rawReferenceImageLabels,
                lastFrameInput: rawLastFrameBase64
            });
            const workflowResult = await generateGoogleFlowWorkflowVideo({
                prompt,
                // 无图 = 文生视频；无标签单图 = 首帧；资产标签单图或多图 = Ingredients。
                firstFrameInput: flowInputs.firstFrameInput,
                referenceImageInputs: flowInputs.referenceImageInputs,
                referenceVideoInput: rawReferenceVideo || null,
                aspectRatio: aspectRatio || '16:9',
                duration: duration || videoProvider?.supportedDurations?.[0] || 4,
                modelId: videoModel,
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15,
                nodeId,
                workflowId,
                signal: cancellation?.signal,
                executionMode: executionModeFor(req.app, videoModel)
            });
            videoBuffer = workflowResult.buffer;
            videoExtension = workflowResult.extension;
            workflowRunId = workflowResult.runId;

        } else if (isJimengWorkflowModel) {
            // 即梦是「文字为主、参考素材可选」：不接图也能生成。
            // 连进来的图（单张首帧口或多张参考）一律作为参考素材，即梦没有首帧概念。
            // 图与它的名字必须同进同出：先按同一份索引配好对，任何一边单独过滤都会错位。
            const rawPairs = (Array.isArray(rawReferenceImages) ? rawReferenceImages : [])
                .map((input, index) => ({
                    input,
                    label: Array.isArray(rawReferenceImageLabels) ? rawReferenceImageLabels[index] : undefined
                }))
                .filter(item => Boolean(item.input));
            // 兜底：老节点可能仍带着首/尾帧字段（即梦上线前保存的画布）。
            // 即梦没有首尾帧概念，但那两张图仍然是用户想用的素材——按顺序补进参考素材，
            // 而不是报错让用户手动重连（此时没有画布标签，交给 provider 默认 图片N）。
            if (rawPairs.length === 0) {
                if (rawImageBase64) rawPairs.push({ input: rawImageBase64, label: undefined });
                if (rawLastFrameBase64) rawPairs.push({ input: rawLastFrameBase64, label: undefined });
            }
            const jimengReferenceInputs = rawPairs.map(item => item.input);
            const jimengReferenceLabels = rawPairs.map(item => item.label);
            const workflowResult = await generateJimengWorkflowVideo({
                prompt,
                referenceImageInputs: jimengReferenceInputs,
                referenceLabels: jimengReferenceLabels,
                model: resolveJimengModelLabel(videoModel),
                // HTTP 路径使用画布 id 去查精确 model_req_key。
                videoModelId: videoModel,
                aspectRatio: aspectRatio || '16:9',
                duration: duration || 5,
                resolution: resolution || '720P',
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15,
                nodeId,
                workflowId,
                signal: cancellation?.signal,
                executionMode: executionModeFor(req.app, videoModel)
            });
            videoBuffer = workflowResult.buffer;
            videoExtension = workflowResult.extension;
            workflowRunId = workflowResult.runId;

        } else if (isSeedanceModel) {
            if (!ARK_API_KEY) {
                return res.status(500).json({
                    error: '火山方舟 API Key 未配置，请在设置中填写中国区 ARK_API_KEY'
                });
            }

            const resultVideoUrl = await generateSeedanceVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                referenceAudioUrls,
                modelId: videoModel,
                aspectRatio,
                resolution,
                duration: duration || 5,
                generateAudio: req.body.generateAudio !== false,
                apiKey: ARK_API_KEY
            });
            const videoResponse = await fetch(resultVideoUrl);
            if (!videoResponse.ok) throw new Error('Seedance 视频下载失败');
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else {
            // --- VEO VIDEO GENERATION (Default) ---
            if (!GEMINI_API_KEY) {
                return res.status(500).json({ error: "Server missing API Key config" });
            }

            console.log(`Using Veo model: ${videoModel || 'veo-3.1'}, duration: ${duration || 8}s, generateAudio: ${req.body.generateAudio !== false}`);

            videoBuffer = await generateVeoVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                aspectRatio,
                resolution,
                duration: duration || 8,
                generateAudio: req.body.generateAudio !== false, // Default to true
                apiKey: GEMINI_API_KEY
            });
        }

        // Save to library - use unique filename to preserve previous generations
        const saved = saveBufferToFile(videoBuffer, targetDir, 'vid', videoExtension);
        const resultUrl = `${urlPrefix}/${saved.filename}`;

        // Determine metadata ID: use nodeId for recovery if available, otherwise use file ID
        const metadataId = nodeId || saved.id;

        // Save metadata (id must match the metadata filename for delete to work)
        const metadata = {
            id: metadataId,  // Must match the filename for delete API to find it
            filename: saved.filename,
            prompt: prompt,
            model: videoModel || 'veo-3.1',
            aspectRatio: aspectRatio || 'Auto',
            resolution: resolution || 'Auto',
            duration: duration || undefined,
            generateAudio: isBrowserWorkflowModel ? undefined : req.body.generateAudio !== false,
            workflowRunId,
            createdAt: new Date().toISOString(),
            type: 'videos'
        };
        fs.writeFileSync(path.join(targetDir, `${metadataId}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Video saved: ${resultUrl} (model: ${videoModel || 'veo-3.1'})`);
        return res.json({ resultUrl });

    } catch (error) {
        console.error("Server Video Gen Error:", error);
        return sendGenerationError(res, error, 'Video generation failed');
    } finally {
        cancellation?.release();
    }
});

// ============================================================================
// GENERATION CANCELLATION
// ============================================================================

/**
 * 取消某个节点正在进行的图片/视频生成。
 *
 * 响应里的 `submitted` 是关键：为 true 表示请求可能已被平台受理，**本次仍可能
 * 计费**，结果也可能出现在平台历史里。前端必须原样转述，不能一律显示「已取消」——
 * 这与节点错误 UI 里「已扣费就藏掉重试按钮」是同一条原则。
 */
router.post('/generations/:nodeId/cancel', (req, res) => {
    const { nodeId } = req.params;
    const workflowId = req.body?.workflowId || req.query?.workflowId || '';
    const result = cancelGeneration(workflowId, nodeId);
    if (!result.cancelled) {
        return res.status(404).json({ error: '没有找到进行中的生成任务', cancelled: false });
    }
    return res.json({
        cancelled: true,
        submitted: result.submitted,
        message: result.submitted
            ? '已停止等待，但请求可能已被平台受理并计费，请到对应平台历史记录确认'
            : '生成任务已取消'
    });
});

/** 查询某节点是否还有生成在跑（前端恢复流程用）。 */
router.get('/generations/:nodeId/active', (req, res) => {
    const workflowId = req.query?.workflowId || '';
    return res.json({ active: isGenerationActive(workflowId, req.params.nodeId) });
});

// ============================================================================
// GENERATION STATUS / RECOVERY
// ============================================================================

/**
 * Check if a generation has finished for a specific nodeId.
 * Returns the resultUrl if it exists.
 */
router.get('/generation-status/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { workflowId } = req.query;
        const runtime = {
            backendSessionId: req.app.locals.BACKEND_SESSION_ID,
            backendStartedAt: req.app.locals.BACKEND_STARTED_AT
        };
        const dirs = {
            workflowsDir: req.app.locals.WORKFLOWS_DIR,
            projectsDir: req.app.locals.PROJECTS_DIR
        };

        // Check images metadata
        const imageTarget = resolveProjectMediaTarget(workflowId, 'images', dirs);
        const imageMetaPath = path.join(imageTarget.targetDir, `${nodeId}.json`);
        if (fs.existsSync(imageMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(imageMetaPath, 'utf8'));
            return res.json({ ...runtime, status: 'success', resultUrl: `${imageTarget.urlPrefix}/${meta.filename}`, type: 'image', createdAt: meta.createdAt });
        }

        // Check videos metadata
        const videoTarget = resolveProjectMediaTarget(workflowId, 'videos', dirs);
        const videoMetaPath = path.join(videoTarget.targetDir, `${nodeId}.json`);
        if (fs.existsSync(videoMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(videoMetaPath, 'utf8'));
            return res.json({ ...runtime, status: 'success', resultUrl: `${videoTarget.urlPrefix}/${meta.filename}`, type: 'video', createdAt: meta.createdAt });
        }

        res.json({ ...runtime, status: 'pending' });
    } catch (error) {
        console.error("Status Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
