/**
 * videoHelpers.ts
 * 
 * Utility functions for video processing and manipulation.
 * Handles video frame extraction and conversion operations.
 */

/**
 * Extracts the last frame from a video URL as a base64 encoded image
 * 
 * @param videoUrl - URL of the video to extract from (can be data URI or HTTP URL)
 * @returns Promise resolving to base64 encoded PNG image
 * @throws Error if video fails to load or canvas context is unavailable
 * 
 * @example
 * const lastFrame = await extractVideoLastFrame(videoUrl);
 * // Returns: "data:image/png;base64,iVBORw0KGgo..."
 */
export const extractVideoLastFrame = (videoUrl: string, timeoutMs = 15_000): Promise<string> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        let settled = false;
        let seekStarted = false;
        const timer = window.setTimeout(() => finish(new Error('视频尾帧提取超时')), timeoutMs);

        const finish = (error?: Error, value?: string) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            video.onloadedmetadata = null;
            video.onloadeddata = null;
            video.onseeked = null;
            video.onerror = null;
            if (error) reject(error);
            else if (value) resolve(value);
            else reject(new Error('视频尾帧提取失败'));
        };

        const drawFrame = () => {
            if (settled || !video.videoWidth || !video.videoHeight) {
                if (!settled) finish(new Error('视频没有可用画面'));
                return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                finish(new Error('Canvas context unavailable'));
                return;
            }
            try {
                ctx.drawImage(video, 0, 0);
                finish(undefined, canvas.toDataURL('image/png'));
            } catch (error) {
                finish(error instanceof Error ? error : new Error('视频画面读取失败'));
            }
        };

        const seekToLastFrame = () => {
            if (settled || seekStarted) return;
            const duration = Number(video.duration);
            if (!Number.isFinite(duration) || duration <= 0) return;
            seekStarted = true;
            // Seeking exactly to duration is unreliable in Chromium and can
            // leave onseeked pending forever. Use the last decodable moment.
            const target = Math.max(0, duration - 0.05);
            try {
                video.currentTime = target;
            } catch (error) {
                finish(error instanceof Error ? error : new Error('视频定位尾帧失败'));
                return;
            }
            if (target === 0) window.setTimeout(drawFrame, 0);
        };

        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.onloadedmetadata = seekToLastFrame;
        video.onloadeddata = seekToLastFrame;
        video.onseeked = drawFrame;
        video.onerror = () => finish(new Error('Video load failed'));
        video.src = videoUrl;
        video.load();
    });
};
