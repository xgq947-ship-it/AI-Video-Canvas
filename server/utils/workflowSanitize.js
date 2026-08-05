/**
 * workflowSanitize.js
 *
 * 保存画布前把节点里的 base64 内联数据落成真实文件。
 *
 * 不这么做的话，一张图就能让 workflow JSON 膨胀到几十 MB，读写都会明显变慢。
 * 原本定义在 server/index.js 的模块作用域，随 /api/workflows 路由一起搬出来。
 */

import fs from 'fs';
import path from 'path';

import { resolveProjectMediaTarget } from './projectAssets.js';
import { PROJECTS_DIR, WORKFLOWS_DIR } from '../runtime/libraryPaths.js';

export function saveBase64ToFile(dataUrl, workflowId) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;

    const mimeType = matches[1];
    const base64Data = matches[2];

    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        let filename, urlType;

        if (mimeType.startsWith('video/')) {
            filename = `${id}.mp4`;
            urlType = 'videos';
        } else {
            const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
            filename = `${id}.${ext}`;
            urlType = 'images';
        }

        const { targetDir, urlPrefix } = resolveProjectMediaTarget(workflowId, urlType, {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });

        fs.writeFileSync(path.join(targetDir, filename), buffer);
        console.log(`  [Workflow Sanitize] Saved base64 → ${urlPrefix}/${filename}`);

        return { url: `${urlPrefix}/${filename}` };
    } catch (err) {
        console.error('  [Workflow Sanitize] Failed to save base64:', err.message);
        return null;
    }
}

/**
 * Sanitizes workflow nodes by converting base64 data to file URLs.
 * Prevents large base64 strings from bloating workflow JSON files.
 * @param {Array} nodes - Array of workflow nodes
 * @returns {{ nodes: Array, sanitizedCount: number }} - Sanitized nodes with file URLs instead of base64, and how many fields were converted
 */
export function sanitizeWorkflowNodes(nodes, workflowId) {
    if (!nodes || !Array.isArray(nodes)) return { nodes, sanitizedCount: 0 };

    let sanitizedCount = 0;

    const sanitized = nodes.map(node => {
        const cleanNode = { ...node };

        // Check resultUrl for base64 data
        if (cleanNode.resultUrl && cleanNode.resultUrl.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.resultUrl, workflowId);
            if (saved) {
                cleanNode.resultUrl = saved.url;
                sanitizedCount++;
            }
        }

        // Check lastFrame for base64 data (video nodes)
        if (cleanNode.lastFrame && cleanNode.lastFrame.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.lastFrame, workflowId);
            if (saved) {
                cleanNode.lastFrame = saved.url;
                sanitizedCount++;
            }
        }

        // Check editorCanvasData for base64 data (Image Editor)
        if (cleanNode.editorCanvasData && cleanNode.editorCanvasData.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.editorCanvasData, workflowId);
            if (saved) {
                cleanNode.editorCanvasData = saved.url;
                sanitizedCount++;
            }
        }

        // Check editorBackgroundUrl for base64 data (Image Editor)
        if (cleanNode.editorBackgroundUrl && cleanNode.editorBackgroundUrl.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.editorBackgroundUrl, workflowId);
            if (saved) {
                cleanNode.editorBackgroundUrl = saved.url;
                sanitizedCount++;
            }
        }

        return cleanNode;
    });

    if (sanitizedCount > 0) {
        console.log(`[Workflow Sanitize] Converted ${sanitizedCount} base64 field(s) to file URLs`);
    }

    return { nodes: sanitized, sanitizedCount };
}
