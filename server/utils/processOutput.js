import { isUtf8 } from 'node:buffer';

function asBuffer(value) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) {
        return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }
    return Buffer.from(String(value ?? ''), 'utf8');
}

/**
 * Decode subprocess output only after all byte chunks have been collected.
 *
 * Calling `chunk.toString()` for every data event can split a multi-byte Chinese
 * character between events and permanently insert U+FFFD. Windows CLI programs
 * may additionally write GB18030 or UTF-16LE instead of UTF-8. Prefer strict
 * UTF-8, then handle the two Windows encodings explicitly.
 */
export function decodeProcessOutput(chunks) {
    const values = Array.isArray(chunks) ? chunks : [chunks];
    const bytes = Buffer.concat(values.filter(value => value != null).map(asBuffer));
    if (bytes.length === 0) return '';

    let text;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
    } else if (isUtf8(bytes)) {
        text = bytes.toString('utf8');
    } else {
        // Chinese Windows commonly uses code page 936. GB18030 is a strict
        // superset and is available in Node's WHATWG TextDecoder.
        text = new TextDecoder('gb18030').decode(bytes);
    }
    return text.replace(/^\uFEFF/, '').replaceAll('\u0000', '');
}

/** Force Python/PyInstaller children to use UTF-8 even on Chinese Windows. */
export function withUtf8PythonEnvironment(environment = process.env) {
    return {
        ...environment,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '0'
    };
}
