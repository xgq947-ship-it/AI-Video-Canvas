/**
 * assetService.ts
 * 
 * Service for managing assets (images/videos) via the backend API.
 */

const API_BASE_URL = '/api';

/**
 * Uploads a base64 data URL to the server and returns the file path URL.
 * 
 * @param dataUrl The base64 data URL to upload
 * @param type 'image' | 'video'
 * @param prompt Optional prompt associated with the asset
 * @returns Promise resolving to the server-side URL (e.g., /library/images/xyz.png)
 */
export const uploadAsset = async (
    dataUrl: string,
    type: 'image' | 'video' = 'image',
    prompt: string = ''
): Promise<string> => {
    try {
        // If it's already a server URL (not base64), return it as is
        if (!dataUrl.startsWith('data:')) {
            return dataUrl;
        }

        const endpoint = type === 'image' ? `${API_BASE_URL}/assets/images` : `${API_BASE_URL}/assets/videos`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data: dataUrl,
                prompt: prompt
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to upload asset');
        }

        const result = await response.json();
        return result.url;
    } catch (error) {
        console.error('Asset upload failed:', error);
        throw error;
    }
};

/** 画布上常用的标准画幅，用来把任意像素尺寸归一到最接近的一档。 */
const STANDARD_ASPECT_RATIOS = [
    ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3],
    ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3], ['5:4', 5 / 4],
    ['4:5', 4 / 5], ['21:9', 21 / 9]
] as const;

export const closestAspectRatioLabel = (width: number, height: number): string => {
    const ratio = width / height;
    return STANDARD_ASPECT_RATIOS.reduce((best, current) =>
        Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best
    )[0];
};

/**
 * 量图片尺寸。
 *
 * 刻意走 object URL 而不是 readAsDataURL：后者会把整张图变成 base64 字符串
 * （体积 ×1.33），一张 100MB 的图光这一步就是 133MB 常驻内存，
 * 而这里只是想知道宽高。
 */
export const loadImageBlobSize = (blob: Blob) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
        const objectUrl = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            const size = { width: image.naturalWidth, height: image.naturalHeight };
            URL.revokeObjectURL(objectUrl);
            resolve(size);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('无法识别图片尺寸'));
        };
        image.src = objectUrl;
    });

export interface UploadedProjectImage {
    /** /library/... 形式的项目内地址，可以直接写进节点。 */
    url: string;
    resultAspectRatio: string;
    aspectRatio: string;
}

/**
 * 把一张图片落盘成项目里的文件，返回 /library/... 地址与画幅。
 *
 * 失败时抛错而不是退回 data URL：服务端保存工作流时会把 base64 清掉，
 * 悄悄塞一个 data URL 进节点，等于让这张图在下次保存后凭空消失。
 */
export const uploadProjectImage = async (
    workflowId: string,
    blob: Blob,
    displayName: string,
    signal?: AbortSignal
): Promise<UploadedProjectImage> => {
    const size = await loadImageBlobSize(blob);
    const mime = blob.type || 'image/png';
    const response = await fetch(
        `/api/projects/${encodeURIComponent(workflowId)}/assets/upload-image-binary`,
        {
            method: 'POST',
            headers: {
                'Content-Type': mime,
                'X-Evan-Mime': mime,
                'X-Evan-Filename': encodeURIComponent(displayName),
                'X-Evan-Prompt': encodeURIComponent(displayName)
            },
            body: blob,
            signal,
        }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.url) throw new Error(result.error || '图片上传失败');
    return {
        url: String(result.url),
        resultAspectRatio: `${size.width}/${size.height}`,
        aspectRatio: closestAspectRatioLabel(size.width, size.height),
    };
};
