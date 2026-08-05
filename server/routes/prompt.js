/**
 * routes/prompt.js
 *
 * 识图描述与提示词优化。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';

import { getPromptOptimizerProvider } from '../services/promptOptimizerProviders.js';
import { resolveImageToBase64 } from '../utils/imageHelpers.js';
import {
    buildPromptOptimizationInstruction,
    formatOptimizedPrompt,
    getPromptOptimizationProfile
} from '../../shared/promptOptimizationProfiles.js';
import { LIBRARY_DIR } from '../runtime/libraryPaths.js';

// 原来在 index.js 里闭包引用 app.locals；路由模块改为按请求取，语义不变
// （app.locals 在启动和改密钥时都会被刷新，两处读到的都是最新值）。
const clientFor = req => new GoogleGenAI({ apiKey: req.app.locals.GEMINI_API_KEY || '' });

const router = express.Router();

// ============================================================================
// GEMINI IMAGE DESCRIPTION API
// ============================================================================

// Describe an image for prompt generation
router.post('/gemini/describe-image', async (req, res) => {
    try {
        const { imageUrl, prompt } = req.body;
        console.log(`[Gemini DescribeV2] Request received. imageUrl: ${imageUrl ? (imageUrl.length > 100 ? imageUrl.substring(0, 100) + '...' : imageUrl) : 'missing'}`);
        // DEBUG: Verify story context injection
        if (prompt) {
            console.log('[Gemini DescribeV2] Received Prompt:', prompt);
        }

        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }

        // 统一支持 data URL、旧素材路径和 project 项目目录路径。
        const imageDataUrl = resolveImageToBase64(imageUrl);
        const imageMatch = imageDataUrl?.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/s);
        const imagePart = imageMatch ? {
            inlineData: {
                data: imageMatch[2],
                mimeType: imageMatch[1]
            }
        } : null;

        if (!imagePart) {
            console.log('[Gemini DescribeV2] Failed to process image part');
            return res.status(400).json({ error: 'Could not process image URL. Provide base64 data or a valid library path.', debug: { imageUrl } });
        }

        const client = clientFor(req);
        // Correct SDK usage for @google/genai ^1.32.0
        const result = await client.models.generateContent({
            model: "gemini-2.0-flash",
            contents: {
                parts: [
                    { text: prompt || "Describe this image in detail for video generation." },
                    imagePart
                ]
            }
        });

        let text = "";

        // Handle @google/genai SDK response structure
        if (result.candidates && result.candidates.length > 0) {
            const candidate = result.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                text = candidate.content.parts[0].text || "";
            }
        }
        // Fallback for other potential response shapes
        else if (result.response && typeof result.response.text === 'function') {
            text = result.response.text();
        }

        if (!text) {
            console.warn('[Gemini DescribeV2] Warning: No text content found in response.');
            console.debug('[Gemini DescribeV2] Response dump:', JSON.stringify(result, null, 2));
        }

        res.json({ description: text });

    } catch (error) {
        console.error("Describe image error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Reverse an image into a generation prompt through the prompt backend selected
// in Settings. Codex CLI accepts the current node image directly and needs no
// additional API key.
router.post('/prompt/describe-image', async (req, res) => {
    try {
        const { imageUrl, prompt } = req.body;
        if (!imageUrl) return res.status(400).json({ error: '当前节点没有可分析的图片' });
        if (!prompt) return res.status(400).json({ error: '缺少图片提示词生成指令' });

        const imageDataUrl = resolveImageToBase64(imageUrl);
        if (!imageDataUrl?.startsWith('data:image/')) {
            return res.status(400).json({ error: '无法读取当前节点图片，请确认项目素材文件仍然存在' });
        }

        const providerId = req.app.locals.PROMPT_OPTIMIZER_PROVIDER || 'deepseek';
        const provider = getPromptOptimizerProvider(providerId);
        if (!provider) return res.status(400).json({ error: `未知的提示词后端：${providerId}` });
        if (!provider.supportsImage) {
            return res.status(400).json({ error: `${provider.label} 不支持识图，请在设置中选择 Codex CLI（本机）` });
        }

        const model = req.app.locals.PROMPT_OPTIMIZER_MODEL || provider.defaultModel;
        let text;
        try {
            text = await provider.run({
                systemInstruction: prompt,
                userPrompt: '请严格按照上述规则分析随请求附带的当前节点图片。',
                imageDataUrl,
                model,
                effort: provider.defaultEffort || '',
                temperature: 0.2,
                maxTokens: 2500,
                libraryDir: req.app.locals.LIBRARY_DIR
            });
        } catch (upstreamError) {
            return res.status(upstreamError.status || 502).json({ error: upstreamError.message });
        }

        const description = String(text || '').trim();
        if (!description) return res.status(500).json({ error: '图片提示词生成结果为空' });
        return res.json({ description, provider: providerId, model });
    } catch (error) {
        console.error('Reverse image prompt error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Optimize image/video prompts through extensible shared profiles + pluggable LLM backends.
// System instruction is model-agnostic (shared/promptOptimizationProfiles.js); the backend is
// chosen by PROMPT_OPTIMIZER_PROVIDER (default DeepSeek). Adding Claude / Codex = register a
// provider in services/promptOptimizerProviders.js — this handler stays unchanged.
const optimizePromptHandler = async (req, res) => {
    try {
        const { prompt, profileId = 'video', context = {} } = req.body;
        const profile = getPromptOptimizationProfile(profileId);

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        if (!profile) {
            return res.status(400).json({ error: `Unknown prompt optimization profile: ${profileId}` });
        }

        const providerId = req.app.locals.PROMPT_OPTIMIZER_PROVIDER || 'deepseek';
        const provider = getPromptOptimizerProvider(providerId);
        if (!provider) {
            return res.status(400).json({ error: `未知的提示词优化后端：${providerId}` });
        }
        // HTTP API 后端需要密钥；本地 CLI 后端（apiKeyField 为 null）用本机已登录的 CLI，无需密钥。
        let apiKey;
        if (provider.apiKeyField) {
            apiKey = req.app.locals[provider.apiKeyField];
            if (!apiKey) {
                return res.status(400).json({ error: `未配置 ${provider.apiKeyField}，请先在 API 密钥设置中添加` });
            }
        }
        const model = req.app.locals.PROMPT_OPTIMIZER_MODEL || provider.defaultModel;
        const effort = provider.defaultEffort || '';
        console.log(`[Prompt Optimize:${providerId}] Model: ${model}${effort ? ` (effort=${effort})` : ''}. Profile: ${profileId}. Prompt: ${prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}`);

        const systemInstruction = buildPromptOptimizationInstruction(profile, context);

        let text;
        try {
            text = await provider.run({
                systemInstruction,
                userPrompt: prompt,
                apiKey,
                model,
                effort,
                temperature: 0.25,
                maxTokens: 2500,
                libraryDir: req.app.locals.LIBRARY_DIR
            });
        } catch (upstreamError) {
            return res.status(upstreamError.status || 502).json({ error: upstreamError.message });
        }

        if (!text) {
            console.warn(`[Prompt Optimize:${providerId}] Warning: No text content found in response.`);
            return res.status(500).json({ error: 'Failed to optimize prompt' });
        }

        text = formatOptimizedPrompt(text, profile);

        res.json({
            optimizedPrompt: text,
            profileId: profile.id,
            aspectRatio: profile.aspectRatio
        });

    } catch (error) {
        console.error("Optimize prompt error:", error);
        res.status(500).json({ error: error.message });
    }
};

router.post('/prompt/optimize', optimizePromptHandler);
router.post('/gemini/optimize-prompt', optimizePromptHandler);

export default router;
