/**
 * Seedance 官方 API 适配器。
 * 使用火山方舟中国区的异步视频生成任务接口。
 */

export const SEEDANCE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

const MODEL_MAPPING = {
    'seedance-2-0': 'doubao-seedance-2-0-260128',
    'seedance-2-0-fast': 'doubao-seedance-2-0-fast-260128',
    'seedance-1-5-pro': 'doubao-seedance-1-5-pro-251215'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function mapSeedanceModelName(modelId) {
    return MODEL_MAPPING[modelId] || MODEL_MAPPING['seedance-2-0'];
}

function normalizeRatio(value) {
    const supported = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
    return supported.has(value) ? value : 'adaptive';
}

function normalizeResolution(value, modelId) {
    const normalized = String(value || '').toLowerCase();
    const supported = modelId === 'seedance-2-0-fast'
        ? new Set(['480p', '720p'])
        : modelId === 'seedance-1-5-pro'
            ? new Set(['480p', '720p', '1080p'])
            : new Set(['480p', '720p', '1080p', '4k']);
    return supported.has(normalized) ? normalized : '720p';
}

function normalizeDuration(value, modelId) {
    const parsed = Math.round(Number(value));
    const maxDuration = modelId === 'seedance-1-5-pro' ? 12 : 15;
    return Number.isFinite(parsed) ? Math.min(maxDuration, Math.max(4, parsed)) : 5;
}

export function buildSeedanceRequest({
    prompt,
    imageBase64,
    lastFrameBase64,
    referenceAudioUrls = [],
    modelId,
    aspectRatio,
    resolution,
    duration,
    generateAudio = true
}) {
    const effectiveModelId = MODEL_MAPPING[modelId] ? modelId : 'seedance-2-0';
    const audioReferences = Array.isArray(referenceAudioUrls)
        ? referenceAudioUrls.filter(Boolean).slice(0, 3)
        : [];
    const supportsReferenceAudio = effectiveModelId === 'seedance-2-0' || effectiveModelId === 'seedance-2-0-fast';
    if (audioReferences.length > 0 && !supportsReferenceAudio) {
        throw new Error('输入参考音频仅支持 Seedance 2.0 与 Seedance 2.0 Fast');
    }
    if (lastFrameBase64 && audioReferences.length > 0) {
        throw new Error('Seedance 参考音频不能与尾帧模式同时使用，请保留首帧并移除尾帧');
    }
    if (audioReferences.length > 0 && !imageBase64) {
        throw new Error('Seedance 参考音频必须同时连接至少一张首帧图片');
    }
    const content = [{ type: 'text', text: prompt || '' }];

    if (imageBase64) {
        content.push({
            type: 'image_url',
            image_url: { url: imageBase64 },
            role: 'first_frame'
        });
    }

    if (lastFrameBase64) {
        content.push({
            type: 'image_url',
            image_url: { url: lastFrameBase64 },
            role: 'last_frame'
        });
    }

    for (const audioUrl of audioReferences) {
        content.push({
            type: 'audio_url',
            audio_url: { url: audioUrl },
            role: 'reference_audio'
        });
    }

    return {
        model: mapSeedanceModelName(effectiveModelId),
        content,
        generate_audio: generateAudio !== false,
        ratio: normalizeRatio(aspectRatio),
        resolution: normalizeResolution(resolution, effectiveModelId),
        duration: normalizeDuration(duration, effectiveModelId),
        watermark: false,
        return_last_frame: true
    };
}

async function readApiResponse(response) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.error) {
        const detail = result.error?.message || result.message || `HTTP ${response.status}`;
        throw new Error(`火山方舟 Seedance API 请求失败：${detail}`);
    }
    return result;
}

async function pollSeedanceTask(taskId, apiKey, maxWaitMs = 900000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
        await sleep(5000);
        const response = await fetch(`${SEEDANCE_BASE_URL}/contents/generations/tasks/${taskId}`, {
            headers: { Authorization: `Bearer ${apiKey}` }
        });
        const result = await readApiResponse(response);
        const status = result.status;

        console.log(`[Seedance] 任务 ${taskId} 状态：${status}`);

        if (status === 'succeeded') {
            const videoUrl = result.content?.video_url;
            if (!videoUrl) throw new Error('Seedance 任务成功，但响应中没有视频地址');
            return videoUrl;
        }
        if (['failed', 'cancelled', 'expired'].includes(status)) {
            throw new Error(`Seedance 生成失败：${result.error?.message || status}`);
        }
    }

    throw new Error('Seedance 生成超时');
}

export async function generateSeedanceVideo(options) {
    const { apiKey } = options;
    if (!apiKey) throw new Error('火山方舟 API Key 未配置');

    const requestBody = buildSeedanceRequest(options);
    console.log(`[Seedance] 创建任务：${requestBody.model}，音频：${requestBody.generate_audio ? '开启' : '关闭'}`);

    const response = await fetch(`${SEEDANCE_BASE_URL}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    const result = await readApiResponse(response);
    const taskId = result.id;
    if (!taskId) throw new Error('Seedance API 未返回任务 ID');

    return pollSeedanceTask(taskId, apiKey);
}
