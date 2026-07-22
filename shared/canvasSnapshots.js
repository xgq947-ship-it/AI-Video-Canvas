/**
 * Keep image-editor undo snapshots as binary blobs instead of base64 strings.
 * The bytes are identical; only the in-memory representation changes.
 */

/** @param {string} dataUrl */
export const dataUrlToBlob = (dataUrl) => {
    const separator = dataUrl.indexOf(',');
    if (separator < 0) throw new TypeError('Invalid data URL');

    const header = dataUrl.slice(0, separator);
    const payload = dataUrl.slice(separator + 1);
    const mimeType = /^data:([^;,]+)/.exec(header)?.[1] || 'application/octet-stream';
    const binary = header.includes(';base64') ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
};

/**
 * @param {string | Blob} snapshot
 * @returns {{ src: string, release: () => void }}
 */
export const snapshotImageSource = (snapshot) => {
    if (typeof snapshot === 'string') {
        return { src: snapshot, release: () => {} };
    }

    const src = URL.createObjectURL(snapshot);
    return { src, release: () => URL.revokeObjectURL(src) };
};
