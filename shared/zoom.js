/**
 * shared/zoom.js
 *
 * 画布缩放计算（纯函数，前端与测试共用）。
 *
 * 为什么需要区分触控板与鼠标滚轮：
 * 同一个 wheel 事件，两种设备给出的 deltaY 数量级差很多——
 *   - 触控板捏合：deltaY 约 1~10，且每秒触发几十次（连续手势）
 *   - 鼠标滚轮：一格 deltaY 约 100（Chrome）或按“行”计的 3（deltaMode=1，Firefox）
 * 若只用一个按滚轮调好的系数（历史实现是 exp(-deltaY * 0.001)），
 * 触控板每次事件只缩放 0.2%，手感就是“推不动”。
 *
 * 因此这里先把 deltaY 归一化成像素，再按设备类型选灵敏度。
 */

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 2;

/** 小于该像素量级、且以像素为单位的 delta，视为触控板的连续手势 */
export const TRACKPAD_DELTA_THRESHOLD = 50;

/** 触控板：每次事件量小但触发密集，用较高灵敏度 */
export const TRACKPAD_SENSITIVITY = 0.01;
/** 鼠标滚轮：单次事件量大且离散，用较低灵敏度，避免一格跳太多 */
export const WHEEL_SENSITIVITY = 0.002;

/**
 * 把 wheel 的 deltaY 归一化为像素。
 * deltaMode: 0=像素, 1=行, 2=页
 */
export const normalizeWheelDelta = (deltaY, deltaMode = 0) => {
    if (deltaMode === 1) return deltaY * 16;  // 行高近似 16px
    if (deltaMode === 2) return deltaY * 800; // 一页近似一屏
    return deltaY;
};

/**
 * 是否为触控板的连续缩放手势。
 * 触控板总是以像素为单位（deltaMode=0）且单次量很小；
 * deltaMode 非 0 必定来自鼠标滚轮，不能按触控板处理（否则 Firefox 滚轮会快到失控）。
 */
export const isTrackpadGesture = (deltaY, deltaMode = 0) =>
    deltaMode === 0 && Math.abs(deltaY) < TRACKPAD_DELTA_THRESHOLD;

/**
 * 由一次 wheel 事件算出缩放倍率（>1 放大，<1 缩小）。
 * @param {number} deltaY
 * @param {number} [deltaMode=0]
 * @returns {number} 乘性倍率
 */
export const zoomFactorFromWheel = (deltaY, deltaMode = 0) => {
    const sensitivity = isTrackpadGesture(deltaY, deltaMode)
        ? TRACKPAD_SENSITIVITY
        : WHEEL_SENSITIVITY;
    const px = normalizeWheelDelta(deltaY, deltaMode);
    return Math.exp(-px * sensitivity);
};

/** 把缩放值限制在允许区间内 */
export const clampZoom = (zoom) => Math.min(Math.max(ZOOM_MIN, zoom), ZOOM_MAX);
