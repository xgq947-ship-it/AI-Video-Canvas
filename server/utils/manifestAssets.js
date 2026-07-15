/**
 * server/utils/manifestAssets.js
 *
 * 服务端专用：清单素材的路径安全解析与存在性检查（需要 fs / path）。
 * 纯时间/结构逻辑在 shared/manifest.js。
 */
import fs from 'fs';
import path from 'path';
import { normalizeAssetPath, collectAssetRefs } from '../../shared/manifest.js';

/**
 * 把清单中的素材相对路径安全解析为 libraryDir 内的绝对路径。
 * 防止路径穿越：解析结果必须严格位于 libraryDir 之内，否则抛错。
 * @param {string} libraryDir 素材根目录（绝对路径）
 * @param {string} file 原始素材地址（可为 /library/... 或相对路径）
 * @returns {string} 绝对路径
 */
export const resolveAssetPath = (libraryDir, file) => {
  const rel = normalizeAssetPath(file);
  if (!rel) throw new Error('素材路径为空');
  const root = path.resolve(libraryDir);
  const resolved = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`非法素材路径（越界）: ${file}`);
  }
  return resolved;
};

/**
 * 找出清单中引用但磁盘上不存在的素材。
 * @param {string} libraryDir
 * @param {any} manifest
 * @returns {Array<{kind:string,id:string,raw:string,path:string,reason:string}>}
 */
export const findMissingAssets = (libraryDir, manifest) => {
  const missing = [];
  for (const ref of collectAssetRefs(manifest)) {
    try {
      const abs = resolveAssetPath(libraryDir, ref.raw);
      if (!fs.existsSync(abs)) {
        missing.push({ ...ref, reason: '文件不存在' });
      }
    } catch (e) {
      missing.push({ ...ref, reason: e.message });
    }
  }
  return missing;
};
