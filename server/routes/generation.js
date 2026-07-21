/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Kling AI, Hailuo AI, and OpenAI GPT Image providers.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateKlingVideo, generateKlingImage, generateKlingMultiImage } from '../services/kling.js';
import { generateGeminiImage, generateVeoVideo } from '../services/gemini.js';
import { generateHailuoVideo } from '../services/hailuo.js';
import { generateSeedanceVideo } from '../services/seedance.js';
import { generateGoogleFlowWorkflowVideo, GOOGLE_FLOW_WORKFLOW_MODEL_ID } from '../services/googleFlowWorkflow.js';
import { generateJimengWorkflowVideo, JIMENG_WORKFLOW_MODEL_ID } from '../services/jimengVideoWorkflow.js';
import { generateGoogleFlowWorkflowImage, GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID, isGoogleFlowImageWorkflowModel } from '../services/googleFlowImageWorkflow.js';
import { generateOpenAIImage } from '../services/openai.js';
import { resolveAudioToBase64, resolveImageToBase64, saveBufferToFile } from '../utils/imageHelpers.js';

const router = express.Router();

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', async (req, res) => {
    try {
        const { nodeId, prompt, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel, klingReferenceMode, klingFaceIntensity, klingSubjectIntensity } = req.body;
        const { GEMINI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, OPENAI_API_KEY, IMAGES_DIR, LIBRARY_DIR } = req.app.locals;

        // Determine provider
        const isKlingModel = imageModel && imageModel.startsWith('kling-');
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
        } else if (isKlingModel) {
            // --- KLING AI IMAGE GENERATION ---
            if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
                return res.status(500).json({
                    error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                });
            }

            console.log(`Using Kling AI model for image: ${imageModel}`);

            // Resolve images if provided
            let resolvedImages = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                resolvedImages = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            let klingImageUrl;

            // Determine which API to use based on model and reference images:
            // - kling-v1-5: Uses standard API with image_reference parameter
            // - kling-v2, kling-v2-1: Use Multi-Image API (image_reference not supported)
            const isV2Model = imageModel === 'kling-v2' || imageModel === 'kling-v2-1' || imageModel === 'kling-v2-new';
            const hasReferenceImages = resolvedImages && resolvedImages.length > 0;

            if (hasReferenceImages && isV2Model) {
                // V2 models: Use Multi-Image API for image-to-image
                console.log(`Using Kling Multi-Image API for ${imageModel} with ${resolvedImages.length} subject image(s)`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else if (hasReferenceImages && resolvedImages.length > 1) {
                // Multiple images with non-V2 model: Use Multi-Image API
                console.log(`Using Kling Multi-Image API with ${resolvedImages.length} subject images`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else {
                // V1.5 or text-to-image: Use standard API (V1.5 supports image_reference)
                klingImageUrl = await generateKlingImage({
                    prompt,
                    imageBase64: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    klingReferenceMode,
                    klingFaceIntensity,
                    klingSubjectIntensity,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from Kling's URL
            const imageResponse = await fetch(klingImageUrl);
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Kling');
            }
            imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

            if (klingImageUrl.includes('.jpg') || klingImageUrl.includes('.jpeg')) {
                imageFormat = 'jpg';
            }

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
        const { nodeId, prompt, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64, referenceImages: rawReferenceImages, motionReferenceUrl: rawMotionReferenceUrl, referenceAudioUrls: rawReferenceAudioUrls, aspectRatio, resolution, duration, videoModel } = req.body;
        const { GEMINI_API_KEY, KLING_ACCESS_KEY, KLING_SECRET_KEY, KLING_API_KEY, ARK_API_KEY, HAILUO_API_KEY, VIDEOS_DIR, LIBRARY_DIR } = req.app.locals;

        // Determine provider
        const isKlingModel = videoModel && videoModel.startsWith('kling-');
        const isSeedanceModel = videoModel && videoModel.startsWith('seedance-');
        const isHailuoModel = videoModel && videoModel.startsWith('hailuo-');
        const isGoogleFlowWorkflowModel = videoModel === GOOGLE_FLOW_WORKFLOW_MODEL_ID;
        const isJimengWorkflowModel = videoModel === JIMENG_WORKFLOW_MODEL_ID;
        // 两个 provider 都走本地 9222 页面 workflow：输入是真实文件路径而非 base64。
        const isBrowserWorkflowModel = isGoogleFlowWorkflowModel || isJimengWorkflowModel;

        // 页面 workflow 需要真实首帧路径；其他供应商继续使用 base64 输入。
        const imageBase64 = isBrowserWorkflowModel ? null : resolveImageToBase64(rawImageBase64);
        const lastFrameBase64 = isBrowserWorkflowModel ? null : resolveImageToBase64(rawLastFrameBase64);
        const motionReferenceUrl = isBrowserWorkflowModel ? null : resolveImageToBase64(rawMotionReferenceUrl);
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
                libraryDir: LIBRARY_DIR,
                timeoutMinutes: 15
            });
            videoBuffer = workflowResult.buffer;
            videoExtension = workflowResult.extension;
            workflowRunId = workflowResult.runId;

        } else if (isJimengWorkflowModel) {
            // 即梦是「文字为主、参考素材可选」：不接图也能生成。
            // 连进来的图（单张首帧口或多张参考）一律作为参考素材，即梦没有首帧概念。
            const jimengReferenceInputs = [
                ...(Array.isArray(rawReferenceImages) ? rawReferenceImages.filter(Boolean) : [])
            ];
            if (jimengReferenceInputs.length === 0 && rawImageBase64) {
                jimengReferenceInputs.push(rawImageBase64);
            }
            if (rawLastFrameBase64) {
                return res.status(400).json({ error: '即梦视频暂不支持尾帧；请把图片作为参考素材连接' });
            }
            const workflowResult = await generateJimengWorkflowVideo({
                prompt,
                referenceImageInputs: jimengReferenceInputs,
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

        } else if (isKlingModel) {
            // --- KLING AI VIDEO GENERATION ---

            // Check if this is a Kling 2.6 model (route to Fal.ai - official API doesn't support v2.6)
            const isKling26 = videoModel === 'kling-v2-6';
            // Check if this is a motion control request (kling-v2-6 with motion reference)
            const isMotionControl = isKling26 && motionReferenceUrl;

            let resultVideoUrl;

            if (isKling26) {
                // --- KLING 2.6 VIA FAL.AI ---
                // Official Kling API doesn't support v2.6, use fal.ai instead
                const { FAL_API_KEY } = req.app.locals;

                if (!FAL_API_KEY) {
                    return res.status(500).json({
                        error: "FAL_API_KEY not configured. Add FAL_API_KEY to .env for Kling 2.6."
                    });
                }

                if (isMotionControl) {
                    // Motion Control mode
                    console.log(`\n[Route] Kling 2.6 Motion Control detected - routing to fal.ai`);
                    console.log(`[Route] Motion Reference: ${motionReferenceUrl ? 'YES (' + Math.round(motionReferenceUrl.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Character Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Prompt: ${prompt ? prompt.substring(0, 50) + '...' : '(none)'}`);

                    const { generateFalMotionControl } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalMotionControl({
                        prompt,
                        characterImageBase64: imageBase64,
                        motionVideoBase64: motionReferenceUrl,
                        characterOrientation: 'video',
                        apiKey: FAL_API_KEY
                    });
                } else {
                    // Standard Image-to-Video mode
                    console.log(`\n[Route] Kling 2.6 Image-to-Video - routing to fal.ai`);
                    console.log(`[Route] Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Duration: ${duration || 5}s`);
                    console.log(`[Route] Generate Audio: ${req.body.generateAudio !== false}`);

                    const { generateFalImageToVideo } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalImageToVideo({
                        prompt,
                        imageBase64,
                        duration: String(duration || 5),
                        generateAudio: req.body.generateAudio !== false, // Default to true
                        apiKey: FAL_API_KEY
                    });
                }
            } else {
                // --- STANDARD KLING VIDEO GENERATION ---
                const isKling3 = videoModel === 'kling-v3' || videoModel === 'kling-v3-turbo';
                if (isKling3 && !KLING_API_KEY) {
                    return res.status(500).json({
                        error: 'Kling 3 API Key 未配置，请在 .env 中添加 KLING_API_KEY'
                    });
                }
                if (!isKling3 && (!KLING_ACCESS_KEY || !KLING_SECRET_KEY)) {
                    return res.status(500).json({
                        error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                    });
                }

                console.log(`Using Kling AI model: ${videoModel}, duration: ${duration || 5}s`);

                resultVideoUrl = await generateKlingVideo({
                    prompt,
                    imageBase64,
                    lastFrameBase64,
                    modelId: videoModel,
                    aspectRatio,
                    resolution,
                    duration: duration || 5,
                    generateAudio: req.body.generateAudio !== false,
                    motionReferenceUrl,
                    apiKey: isKling3 ? KLING_API_KEY : undefined,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from the result URL
            const videoResponse = await fetch(resultVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download generated video');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else if (isHailuoModel) {
            // --- HAILUO AI VIDEO GENERATION ---
            if (!HAILUO_API_KEY) {
                return res.status(500).json({
                    error: "Hailuo API key not configured. Add HAILUO_API_KEY to .env"
                });
            }

            console.log(`Using Hailuo AI model: ${videoModel}, duration: ${duration || 6}s`);

            const hailuoVideoUrl = await generateHailuoVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                modelId: videoModel,
                aspectRatio,
                resolution,
                duration: duration || 6,
                apiKey: HAILUO_API_KEY
            });

            // Download from Hailuo's URL
            const videoResponse = await fetch(hailuoVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download video from Hailuo');
            }
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
