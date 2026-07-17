import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAudioToBase64 } from '../server/utils/imageHelpers.js';

test('本地参考音频转换为 Seedance 可用的 data URL', () => {
    const tempLibrary = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-audio-'));
    const audioDir = path.join(tempLibrary, 'audio');
    const previousLibraryDir = process.env.LIBRARY_DIR;

    try {
        fs.mkdirSync(audioDir, { recursive: true });
        fs.writeFileSync(path.join(audioDir, 'voice.mp3'), Buffer.from([0x49, 0x44, 0x33]));
        process.env.LIBRARY_DIR = tempLibrary;

        assert.equal(resolveAudioToBase64('/library/audio/voice.mp3'), 'data:audio/mpeg;base64,SUQz');
        assert.equal(resolveAudioToBase64('https://cdn.example.com/voice.mp3'), 'https://cdn.example.com/voice.mp3');
        assert.equal(resolveAudioToBase64('/library/../secret.mp3'), null);
    } finally {
        if (previousLibraryDir === undefined) delete process.env.LIBRARY_DIR;
        else process.env.LIBRARY_DIR = previousLibraryDir;
        fs.rmSync(tempLibrary, { recursive: true, force: true });
    }
});
