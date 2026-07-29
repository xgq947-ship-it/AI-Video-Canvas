import fs from 'node:fs';
import path from 'node:path';

const MEDIA_TYPES = new Set(['images', 'videos', 'audio']);

function assertSafeAsset(type, filename) {
    if (!MEDIA_TYPES.has(type)) {
        const error = new Error('不支持的素材类型');
        error.code = 'UNSUPPORTED_MEDIA_TYPE';
        throw error;
    }
    if (
        !filename
        || path.basename(filename) !== filename
        || filename === '.'
        || filename === '..'
    ) {
        const error = new Error('素材文件名不合法');
        error.code = 'INVALID_ASSET_FILENAME';
        throw error;
    }
}

function canonicalSidecar(directory, filename) {
    const extension = path.extname(filename);
    return path.join(directory, `${filename.slice(0, -extension.length)}.json`);
}

export function readProjectAssetMetadata(directory, filename) {
    const canonical = canonicalSidecar(directory, filename);
    try {
        if (fs.existsSync(canonical)) {
            return { metadata: JSON.parse(fs.readFileSync(canonical, 'utf8')), sidecarPath: canonical };
        }
    } catch { /* fall through to id-based sidecars */ }

    try {
        for (const entry of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
            const candidate = path.join(directory, entry);
            try {
                const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
                if (metadata?.filename === filename) return { metadata, sidecarPath: candidate };
            } catch { /* ignore malformed sidecars */ }
        }
    } catch { /* missing directory is handled by the caller */ }
    return { metadata: {}, sidecarPath: canonical };
}

export function resolveProjectAssetDisplayName(metadata, filename, { type = 'images', index = 1 } = {}) {
    const manualName = typeof metadata?.displayName === 'string' ? metadata.displayName.trim() : '';
    if (manualName) return manualName;

    const currentFilename = typeof filename === 'string' ? filename.trim() : '';
    if (currentFilename) return currentFilename;

    const resultName = [
        metadata?.resultName,
        metadata?.name,
        metadata?.originalName,
        metadata?.text,
    ].find(value => typeof value === 'string' && value.trim());
    if (resultName) return resultName.trim();

    const prefix = type === 'videos' ? '视频' : type === 'audio' ? '音频' : '图片';
    return `${prefix} ${String(Math.max(1, Number(index) || 1)).padStart(3, '0')}`;
}

export function updateProjectAssetDisplayName(projectRoot, type, filename, displayName) {
    assertSafeAsset(type, filename);
    const nextName = String(displayName || '').trim();
    if (!nextName) {
        const error = new Error('图片名称不能为空');
        error.code = 'EMPTY_DISPLAY_NAME';
        throw error;
    }

    const directory = path.join(projectRoot, type);
    const mediaPath = path.join(directory, filename);
    if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
        const error = new Error('素材文件不存在');
        error.code = 'ENOENT';
        throw error;
    }

    const { metadata, sidecarPath } = readProjectAssetMetadata(directory, filename);
    const nextMetadata = {
        ...metadata,
        filename,
        displayName: nextName,
        type: metadata.type || type,
    };
    const temporaryPath = `${sidecarPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(nextMetadata, null, 2));
    fs.renameSync(temporaryPath, sidecarPath);
    return nextMetadata;
}
