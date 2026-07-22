/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Seedance, browser workflows, and OpenAI GPT Image providers.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateGeminiImage, generateVeoVideo } from '../services/gemini.js';
import { generateSeedanceVideo } from '../services/seedance.js';
import { generateGoogleFlowWorkflowVideo, isGoogleFlowWorkflowModelId } from '../services/googleFlowWorkflow.js';
import { generateJimengWorkflowVideo, isJimengWorkflowModelId, resolveJimengModelLabel } from '../services/jimengVideoWorkflow.js';
import { generateGoogleFlowWorkflowImage, GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID, isGoogleFlowImageWorkflowModel } from '../services/googleFlowImageWorkflow.js';
import { generateOpenAIImage } from '../services/openai.js';
import { resolveAudioToBase64, resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';

const router = express.Router();

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', async (req, res) => {
    try {
        const { nodeId, prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel } = req.body;
        const { GEMINI_API_KEY, OPENAI_API_KEY, IMAGES_DIR, LIBRARY_DIR } = req.app.locals;

        if (imageModel?.startsWith('kling-')) {
            return res.status(400).json({ error: '该图片模型已下线，请切换为 Codex、Google Flow、Gemini 或 OpenAI 图片模型' });
        }

        // Determine provider
        const isOpenAIModel = imageModel && imageModel.startsWith('gpt-image-');
        const isGoogleFlowWorkflowModel = isGoogleFlowImageWorkflowModel(imageModel);

        let imageBuffer;
        let imageFormat = 'png';

        if (isGoogleFlowWorkflowModel) {
            // --- GOOGLE FLOW LOCAL TEXT-TO-IMAGE WORKFLOW ---
            const referenceImages = rawImageBase64
                ? (Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64]).filter(Boolean)
                : [];

            console.log(`Using Google Flow workflow for image: ${imageModel}`);
            const result = await generateGoogleFlowWorkflowImage({
                prompt,
                aspectRatio: aspectRatio || '1:1',
                referenceImageInputs: referenceImages,
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 10,
                modelId: imageModel
            });
            imageBuffer = result.buffer;
            imageFormat = result.extension;
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

        // Save to library - use unique filename to preserve previous generations
        const saved = saveBufferToFile(imageBuffer, IMAGES_DIR, 'img', imageFormat);

        // Determine metadata ID: use nodeId for recovery if available, otherwise use file ID
        const metadataId = nodeId || saved.id;

        // Save metadata (id must match the metadata filename for delete to work)
        const metadata = {
            id: metadataId,  // Must match the filename for delete API to find it
            filename: saved.filename,
            prompt: prompt,
            model: imageModel || 'gemini-pro',
            createdAt: new Date().toISOString(),
            type: 'images'
        };
        fs.writeFileSync(path.join(IMAGES_DIR, `${metadataId}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Image saved: ${saved.url} (model: ${imageModel || 'gemini-pro'})`);
        return res.json({ resultUrl: saved.url });

    } catch (error) {
        console.error("Server Image Gen Error:", error);
        res.status(500).json({ error: error.message || "Image generation failed" });
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', async (req, res) => {
    try {
        const { nodeId, prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64, referenceImages: rawReferenceImages, referenceImageLabels: rawReferenceImageLabels, referenceAudioUrls: rawReferenceAudioUrls, aspectRatio, resolution, duration, videoModel } = req.body;
        const { GEMINI_API_KEY, ARK_API_KEY, VIDEOS_DIR, LIBRARY_DIR } = req.app.locals;

        // 旧项目里的已下线模型不能静默回落到 Veo，避免误扣其他供应商额度。
        if (videoModel?.startsWith('kling-') || videoModel?.startsWith('hailuo-')) {
            return res.status(400).json({ error: '该视频模型已下线，请切换为即梦、Google Flow 或 Seedance' });
        }

        // Determine provider
        const isSeedanceModel = videoModel && videoModel.startsWith('seedance-');
        const isGoogleFlowWorkflowModel = isGoogleFlowWorkflowModelId(videoModel);
        const isJimengWorkflowModel = isJimengWorkflowModelId(videoModel);
        // 两个 provider 都走本地 9222 页面 workflow：输入是真实文件路径而非 base64。
        const isBrowserWorkflowModel = isGoogleFlowWorkflowModel || isJimengWorkflowModel;

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

        if (isGoogleFlowWorkflowModel) {
            // 连 2 张以上图片 → Ingredients 多参考图模式；否则用单张首帧。
            const referenceImageInputs = Array.isArray(rawReferenceImages)
                ? rawReferenceImages.filter(Boolean)
                : [];
            const useIngredients = referenceImageInputs.length >= 2;
            if (!useIngredients) {
                if (!rawImageBase64) {
                    return res.status(400).json({ error: 'Google Flow workflow 需连接一张首帧图片，或连接 2 张以上图片走多参考图（Ingredients）' });
                }
                if (rawLastFrameBase64) {
                    return res.status(400).json({ error: 'Google Flow workflow 单图模式暂不支持尾帧；请只连一张首帧，或连 2 张以上走多参考图' });
                }
            }
            const workflowResult = await generateGoogleFlowWorkflowVideo({
                prompt,
                firstFrameInput: useIngredients ? null : rawImageBase64,
                referenceImageInputs: useIngredients ? referenceImageInputs : [],
                aspectRatio: aspectRatio || '16:9',
                duration: duration || 4,
                modelId: videoModel,
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15
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
                aspectRatio: aspectRatio || '16:9',
                duration: duration || 5,
                resolution: resolution || '720P',
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15
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
        const saved = saveBufferToFile(videoBuffer, VIDEOS_DIR, 'vid', videoExtension);

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
        fs.writeFileSync(path.join(VIDEOS_DIR, `${metadataId}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Video saved: ${saved.url} (model: ${videoModel || 'veo-3.1'})`);
        return res.json({ resultUrl: saved.url });

    } catch (error) {
        console.error("Server Video Gen Error:", error);
        res.status(500).json({ error: error.message || "Video generation failed" });
    }
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
        const { IMAGES_DIR, VIDEOS_DIR } = req.app.locals;

        // Check images metadata
        const imageMetaPath = path.join(IMAGES_DIR, `${nodeId}.json`);
        if (fs.existsSync(imageMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(imageMetaPath, 'utf8'));
            return res.json({ status: 'success', resultUrl: `/library/images/${meta.filename}`, type: 'image', createdAt: meta.createdAt });
        }

        // Check videos metadata
        const videoMetaPath = path.join(VIDEOS_DIR, `${nodeId}.json`);
        if (fs.existsSync(videoMetaPath)) {
            const meta = JSON.parse(fs.readFileSync(videoMetaPath, 'utf8'));
            return res.json({ status: 'success', resultUrl: `/library/videos/${meta.filename}`, type: 'video', createdAt: meta.createdAt });
        }

        res.json({ status: 'pending' });
    } catch (error) {
        console.error("Status Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
