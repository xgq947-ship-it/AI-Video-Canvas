/**
 * scanAssetLibrary.js
 *
 * 扫描 library/assets/<分类>/ 目录，把里面的图片/视频文件同步进 assets.json，
 * 让 GET /api/library（素材库弹窗、侧边栏「资产 → Agent」）能直接读到手动放进去的素材。
 *
 * 规则：
 * - 一级文件夹名是素材分类；允许再嵌套一级子分类（如 Massage Equipment/足疗机）。
 * - 只识别常见图片/视频扩展名，其它文件（含 assets.json 本身、音频、说明文件）忽略。
 * - 已存在于 assets.json 的条目保留原有 id / name / createdAt 及自定义字段，仅把 category、
 *   type 与文件夹/扩展名保持同步；避免每次扫描打乱已保存素材的身份。
 * - 磁盘上已不存在对应文件的旧条目会被清理（它们本就是失效的死链接）。
 * - 仅在有实际变化（新增/删除）或 assets.json 缺失时才写盘，避免无谓 IO。
 *
 * 纯函数式：只依赖传入的 assetsDir，便于测试。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);

/**
 * @param {string} assetsDir  library/assets 的绝对路径
 * @param {{ logger?: Console }} [options]
 * @returns {{ added: number, removed: number, total: number, changed: boolean }}
 */
export function scanAssetLibrary(assetsDir, { logger = console } = {}) {
    const jsonPath = path.join(assetsDir, 'assets.json');

    if (!fs.existsSync(assetsDir)) {
        return { added: 0, removed: 0, total: 0, changed: false };
    }

    // 读取已有索引（按 url 建立稳定身份映射）
    let existing = [];
    if (fs.existsSync(jsonPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (Array.isArray(parsed)) existing = parsed;
        } catch (e) {
            logger?.warn?.(`[asset-scan] assets.json 解析失败，将重建：${e.message}`);
        }
    }
    const byUrl = new Map(
        existing.filter(entry => entry && typeof entry.url === 'string').map(entry => [entry.url, entry])
    );

    // 遍历分类目录；按摩器材等分类允许再嵌套一级子目录。
    const result = [];
    const seenUrls = new Set();
    let added = 0;

    for (const dirent of fs.readdirSync(assetsDir, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue;
        const category = dirent.name;
        const catDir = path.join(assetsDir, category);

        const scanDirectory = (directory, subcategory) => {
            let files;
            try {
                files = fs.readdirSync(directory, { withFileTypes: true });
            } catch {
                return;
            }

            for (const file of files) {
                if (file.isDirectory() && !subcategory) {
                    scanDirectory(path.join(directory, file.name), file.name);
                    continue;
                }
                if (!file.isFile()) continue;
                const ext = path.extname(file.name).toLowerCase();
                const isImage = IMAGE_EXTS.has(ext);
                const isVideo = VIDEO_EXTS.has(ext);
                if (!isImage && !isVideo) continue; // 忽略 json / 音频 / 未知类型

                const url = `/library/assets/${category}/${subcategory ? `${subcategory}/` : ''}${file.name}`;
                seenUrls.add(url);
                const type = isVideo ? 'video' : 'image';
                const prev = byUrl.get(url);

                if (prev) {
                    // 保留原有元数据，仅同步随文件系统变化的字段
                    const normalized = { ...prev, category, type, url };
                    if (subcategory) normalized.subcategory = subcategory;
                    else delete normalized.subcategory;
                    result.push(normalized);
                } else {
                    let createdAt = new Date().toISOString();
                    try {
                        createdAt = fs.statSync(path.join(directory, file.name)).mtime.toISOString();
                    } catch {
                        /* 用当前时间兜底 */
                    }
                    result.push({
                        id: crypto.randomUUID(),
                        name: path.basename(file.name, ext),
                        category,
                        ...(subcategory ? { subcategory } : {}),
                        url,
                        type,
                        createdAt,
                    });
                    added++;
                }
            }
        };

        scanDirectory(catDir, undefined);
    }

    // 磁盘上已消失的旧条目数量
    const removed = existing.filter(
        entry => entry && typeof entry.url === 'string' && !seenUrls.has(entry.url)
    ).length;

    // 与 GET /api/library 一致：按 createdAt 倒序（新→旧）
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const jsonMissing = !fs.existsSync(jsonPath);
    const changed = added > 0 || removed > 0 || existing.length !== result.length;

    if (changed || jsonMissing) {
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    }

    return { added, removed, total: result.length, changed: changed || jsonMissing };
}
