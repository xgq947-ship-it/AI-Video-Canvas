import fs from 'node:fs';
import path from 'node:path';

const supportedExtension = sourcePath => {
    const extension = path.extname(String(sourcePath || '')).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.webp'].includes(extension) ? extension : '.png';
};

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
