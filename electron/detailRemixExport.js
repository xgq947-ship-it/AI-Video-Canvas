import fs from 'node:fs';
import path from 'node:path';

const supportedExtension = sourcePath => {
    const extension = path.extname(String(sourcePath || '')).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png';
};

const safeFolderSegment = value => String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim()
    .slice(0, 80);

const exportTimestamp = value => {
    const date = value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date();
    const pad = number => String(number).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        '_',
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
    ].join('');
};

/** Always creates a new child directory under the user-selected location. */
export function createDetailRemixExportDirectory(parentDir, options = {}) {
    const rawParent = String(parentDir || '').trim();
    if (!rawParent || !path.isAbsolute(rawParent)) throw new Error('请选择导出位置');
    const parent = path.resolve(rawParent);
    const stat = fs.statSync(parent);
    if (!stat.isDirectory()) throw new Error('请选择一个文件夹作为导出位置');
    const projectName = safeFolderSegment(options.projectName) || '商品详情';
    const baseName = `${projectName}_最终详情_${exportTimestamp(options.now)}`;
    for (let suffix = 0; suffix < 1000; suffix += 1) {
        const folderName = suffix === 0 ? baseName : `${baseName}_${String(suffix + 1).padStart(2, '0')}`;
        const destination = path.join(parent, folderName);
        try {
            fs.mkdirSync(destination);
            return destination;
        } catch (error) {
            if (error?.code === 'EEXIST') continue;
            throw error;
        }
    }
    throw new Error('无法创建唯一的详情图导出文件夹');
}

export function planDetailRemixExport(files, destinationDir) {
    const rawDestination = String(destinationDir || '').trim();
    if (!rawDestination || !path.isAbsolute(rawDestination) || !Array.isArray(files) || files.length === 0) {
        throw new Error('没有可导出的详情图片');
    }
    const destination = path.resolve(rawDestination);
    const ordered = [...files].sort((left, right) => (
        Number(left?.order) - Number(right?.order)
        || Number(left?.pageIndex) - Number(right?.pageIndex)
    ));
    const digits = Math.max(2, String(ordered.length).length);
    return ordered.map((file, index) => {
        const sourcePath = path.resolve(String(file?.sourcePath || ''));
        const filename = `${String(index + 1).padStart(digits, '0')}${supportedExtension(sourcePath)}`;
        return {
            ...file,
            sourcePath,
            filename,
            targetPath: path.join(destination, filename),
        };
    });
}

export function findDetailRemixExportCollisions(plan) {
    return (Array.isArray(plan) ? plan : []).filter(item => fs.existsSync(item.targetPath));
}

export function exportDetailRemixFiles(files, destinationDir) {
    const plan = planDetailRemixExport(files, destinationDir);
    const destination = path.resolve(String(destinationDir || ''));
    const stat = fs.statSync(destination);
    if (!stat.isDirectory()) throw new Error('请选择一个文件夹作为导出位置');
    for (const item of plan) {
        const sourceStat = fs.statSync(item.sourcePath);
        if (!sourceStat.isFile()) throw new Error(`找不到待导出的图片：${item.filename}`);
    }
    for (const item of plan) fs.copyFileSync(item.sourcePath, item.targetPath);
    return {
        count: plan.length,
        destination,
        filenames: plan.map(item => item.filename),
    };
}
