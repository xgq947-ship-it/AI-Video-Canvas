/**
 * Reference-image and result-media helpers shared by the three HTTP providers.
 *
 * The browser workflows hand Python a list of file *paths*; the HTTP channels
 * need the bytes instead. Rather than reimplement input resolution (library
 * URL / data URL / remote URL), this reuses the existing resolver and reads the
 * files it produced.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBrowserReferenceImages } from '../googleFlowImageWorkflow.js';
import { fetchWorkflowMedia } from '../../utils/workflowMedia.js';
import { WebProviderError } from './errors.js';

const MIME_BY_EXTENSION = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif'
};

export function mimeTypeForFile(filePath) {
    const extension = path.extname(String(filePath || '')).slice(1).toLowerCase();
    return MIME_BY_EXTENSION[extension] || 'image/png';
}

export function extensionForContentType(contentType, fallback = 'png') {
    const normalized = String(contentType || '').toLowerCase();
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('mp4')) return 'mp4';
    return fallback;
}

/**
 * Resolve canvas reference inputs into in-memory files.
 *
 * @returns {Promise<Array<{buffer: Buffer, fileName: string, mimeType: string}>>}
 */
export async function loadReferenceImageFiles(inputs, libraryDir, { providerName = 'Web HTTP' } = {}) {
    const list = (Array.isArray(inputs) ? inputs : []).filter(Boolean);
    if (list.length === 0) return [];

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-webhttp-ref-'));
    try {
        const paths = await resolveBrowserReferenceImages(list, libraryDir, taskDir, { providerName });
        return paths.map(filePath => ({
            buffer: fs.readFileSync(filePath),
            fileName: path.basename(filePath),
            mimeType: mimeTypeForFile(filePath)
        }));
    } finally {
        try {
            fs.rmSync(taskDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`[web-http] 参考图临时目录清理失败：${error.message}`);
        }
    }
}

/**
 * Download a finished result from the platform CDN.
 *
 * Deliberately runs in Node, not through the page bridge: the media CDNs do not
 * CORS-allow a page to read the response body, and a large video should not be
 * base64-shuttled through `page.evaluate`.
 *
 * The quota is already spent at this point, so a failure is phrased as a
 * recovery instruction rather than "generation failed".
 */
export async function downloadResultMedia(url, {
    providerName,
    expectedType,
    cookieHeader,
    recoveryHint,
    timeoutMs = 120_000
}) {
    const headers = { accept: expectedType === 'video' ? 'video/*,*/*' : 'image/*,*/*' };
    if (cookieHeader) headers.cookie = cookieHeader;
    // Flow's media endpoint is a streaming proxy that expects a Range request.
    if (expectedType === 'video') headers.range = 'bytes=0-';

    const downloaded = await fetchWorkflowMedia(url, {
        providerName,
        expectedType,
        recoveryHint: recoveryHint || '请先到对应平台历史记录中下载本次结果，不要直接重新生成。',
        headers,
        timeoutMs
    });
    return {
        buffer: downloaded.buffer,
        extension: extensionForContentType(downloaded.contentType, expectedType === 'video' ? 'mp4' : 'png'),
        contentType: downloaded.contentType,
        source: 'http'
    };
}

/** Guard used by every provider before it starts spending quota. */
export function requireNonEmptyPrompt(prompt, providerName) {
    if (!String(prompt || '').trim()) {
        throw new WebProviderError(`${providerName}提示词不能为空`, {
            code: 'PROTOCOL_CHANGED',
            submitted: false
        });
    }
    return String(prompt).trim();
}
