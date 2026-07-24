#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'public', 'TwitCanva-logo.png');
const BUILD_DIR = path.join(ROOT, 'build');
const ICONSET_DIR = path.join(BUILD_DIR, 'icon.iconset');

function fail(message) {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

async function renderPng(size) {
    return sharp(SOURCE)
        .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
}

async function buildWindowsIcon() {
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = await Promise.all(sizes.map(renderPng));
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);

    let offset = header.length + (16 * images.length);
    const entries = images.map((image, index) => {
        const size = sizes[index];
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size >= 256 ? 0 : size, 0);
        entry.writeUInt8(size >= 256 ? 0 : size, 1);
        entry.writeUInt8(0, 2);
        entry.writeUInt8(0, 3);
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(image.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += image.length;
        return entry;
    });
    fs.writeFileSync(
        path.join(BUILD_DIR, 'icon.ico'),
        Buffer.concat([header, ...entries, ...images])
    );
}

async function buildMacIcon() {
    if (process.platform !== 'darwin') return;
    fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
    fs.mkdirSync(ICONSET_DIR, { recursive: true });
    const variants = [
        ['icon_16x16.png', 16],
        ['icon_16x16@2x.png', 32],
        ['icon_32x32.png', 32],
        ['icon_32x32@2x.png', 64],
        ['icon_128x128.png', 128],
        ['icon_128x128@2x.png', 256],
        ['icon_256x256.png', 256],
        ['icon_256x256@2x.png', 512],
        ['icon_512x512.png', 512],
        ['icon_512x512@2x.png', 1024]
    ];
    for (const [filename, size] of variants) {
        fs.writeFileSync(path.join(ICONSET_DIR, filename), await renderPng(size));
    }
    execFileSync('/usr/bin/iconutil', [
        '--convert', 'icns',
        '--output', path.join(BUILD_DIR, 'icon.icns'),
        ICONSET_DIR
    ], { stdio: 'inherit' });
    fs.rmSync(ICONSET_DIR, { recursive: true, force: true });
}

if (!fs.existsSync(SOURCE)) fail(`找不到品牌图标：${SOURCE}`);
fs.mkdirSync(BUILD_DIR, { recursive: true });
await buildWindowsIcon();
await buildMacIcon();
console.log(`✅ Windows 图标：${path.join(BUILD_DIR, 'icon.ico')}`);
if (process.platform === 'darwin') {
    console.log(`✅ macOS 图标：${path.join(BUILD_DIR, 'icon.icns')}`);
}
