/**
 * 视频模型能力判定（前后端共用的单一事实来源）。
 *
 * 这里只回答一件事：连进视频节点的图片，到底是「首帧/尾帧」还是「参考素材」。
 * 判错的后果很具体——即梦没有首帧概念，把图当首尾帧送过去会被直接拒绝。
 */

export const GOOGLE_FLOW_VIDEO_MODEL = 'google-flow-omni-flash';
export const GOOGLE_FLOW_VEO_3_1_LITE_VIDEO_MODEL = 'google-flow-veo-3-1-lite';
export const JIMENG_VIDEO_MODEL = 'jimeng-seedance-2-0';
export const JIMENG_FAST_VIDEO_MODEL = 'jimeng-seedance-2-0-fast';
export const JIMENG_MINI_VIDEO_MODEL = 'jimeng-seedance-2-0-mini';
export const JIMENG_STANDARD_FAST_VIDEO_MODEL = 'jimeng-seedance-2-0-fast-standard';
export const JIMENG_STANDARD_VIDEO_MODEL = 'jimeng-seedance-2-0-standard';
const JIMENG_VIDEO_MODELS = new Set([
    JIMENG_MINI_VIDEO_MODEL,
    JIMENG_FAST_VIDEO_MODEL,
    JIMENG_VIDEO_MODEL,
    JIMENG_STANDARD_FAST_VIDEO_MODEL,
    JIMENG_STANDARD_VIDEO_MODEL
]);

// 走 Evan 专属 Chrome workflow 的视频模型（相对 API 直连供应商）。
export const BROWSER_WORKFLOW_VIDEO_MODELS = new Set([
    GOOGLE_FLOW_VIDEO_MODEL,
    GOOGLE_FLOW_VEO_3_1_LITE_VIDEO_MODEL,
    ...JIMENG_VIDEO_MODELS
]);

export function isBrowserWorkflowVideoModel(videoModel) {
    return BROWSER_WORKFLOW_VIDEO_MODELS.has(videoModel);
}

/**
 * 该模型是否**只有参考素材、没有首尾帧概念**。
 * 即梦：连 1 张也是参考素材，不是首帧。
 */
export function usesReferenceMaterialsOnly(videoModel) {
    return JIMENG_VIDEO_MODELS.has(videoModel);
}

/**
 * 连接的图片是否应该整体作为「多参考图」交给 workflow，而不是当首尾帧插值。
 *
 * - 即梦：≥1 张即走参考素材（它根本没有首帧模式）。
 * - Google Flow：连 1 张仍是首帧，≥2 张才走 Ingredients（保持既有行为）。
 */
export function shouldUseReferenceImages(videoModel, imageCount) {
    if (usesReferenceMaterialsOnly(videoModel)) return imageCount >= 1;
    if (String(videoModel || '').startsWith('google-flow')) return imageCount >= 2;
    return false;
}

/** 走参考图模式时，最少需要几张已出图的图片。 */
export function minimumReferenceImages(videoModel) {
    return usesReferenceMaterialsOnly(videoModel) ? 1 : 2;
}
