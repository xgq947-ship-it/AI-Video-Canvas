/**
 * libraryPaths.js
 *
 * 素材库的目录布局，从 RUNTIME_PATHS 单向推导。
 *
 * 以前这些常量只存在于 server/index.js 的模块作用域里，于是所有用到它们的路由
 * 也只能一起挤在那个两千行的文件里。抽出来之后，路由模块可以直接 import，
 * 不必再靠 app.locals 绕一圈。
 *
 * 副作用（建目录）刻意留在 ensureLibraryDirs() 里显式调用，import 本身是纯的，
 * 测试可以放心引用常量而不会在磁盘上创建目录。
 */

import fs from 'fs';
import path from 'path';

import { RUNTIME_PATHS } from './paths.js';
import { MASSAGE_EQUIPMENT_NAMES } from '../../shared/massageEquipmentCategories.js';

export const LIBRARY_DIR = RUNTIME_PATHS.libraryDir;
export const WORKFLOWS_DIR = path.join(LIBRARY_DIR, 'workflows');
export const IMAGES_DIR = path.join(LIBRARY_DIR, 'images');
export const VIDEOS_DIR = path.join(LIBRARY_DIR, 'videos');
export const AUDIO_DIR = path.join(LIBRARY_DIR, 'audio');
export const PROJECTS_DIR = path.join(LIBRARY_DIR, 'projects');
export const LIBRARY_ASSETS_DIR = path.join(LIBRARY_DIR, 'assets');
export const CODEX_IMAGE_JOBS_DIR = path.join(LIBRARY_DIR, 'codex-image-jobs');

export const MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES = MASSAGE_EQUIPMENT_NAMES;

/** 传给 projectAssets 系列工具的目录集合。 */
export const projectAssetDirs = () => ({
    libraryDir: LIBRARY_DIR,
    projectsDir: PROJECTS_DIR,
    imagesDir: IMAGES_DIR,
    videosDir: VIDEOS_DIR,
    audioDir: AUDIO_DIR
});

/** 建好所有目录。只应由进程启动路径调用一次。 */
export function ensureLibraryDirs() {
    [LIBRARY_DIR, WORKFLOWS_DIR, IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR, PROJECTS_DIR, LIBRARY_ASSETS_DIR, CODEX_IMAGE_JOBS_DIR]
        .forEach(dir => {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        });

    // 按摩器材的两级分类要在 Finder 里也真实存在，不只是界面上有。
    MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES.forEach(subcategory => {
        fs.mkdirSync(path.join(LIBRARY_ASSETS_DIR, 'Massage Equipment', subcategory), { recursive: true });
    });
}
