import crypto from 'crypto';

const normalizeExtension = (extension) => {
    const value = String(extension || '').toLowerCase();
    if (!/^\.[a-z0-9]{1,8}$/.test(value)) return '.bin';
    return value;
};

export const createUniqueAssetFilename = (name, extension, id = crypto.randomUUID()) => {
    const slug = String(name || '')
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}-]+/gu, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || 'asset';

    const uniqueSuffix = String(id).replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
    return `${slug}_${uniqueSuffix || crypto.randomUUID().replaceAll('-', '').slice(0, 12)}${normalizeExtension(extension)}`;
};
