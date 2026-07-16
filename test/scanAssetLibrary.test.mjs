import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanAssetLibrary } from '../server/utils/scanAssetLibrary.js';

const silent = { warn: () => {} };

const makeAssetsDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
const readJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));

test('从空目录发现分类文件夹里的图片/视频并生成 assets.json', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Character'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'Scene'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Character', 'lin_mo.png'), 'x');
    fs.writeFileSync(path.join(dir, 'Scene', 'clip.mp4'), 'x');

    const res = scanAssetLibrary(dir, { logger: silent });
    assert.equal(res.added, 2);
    assert.equal(res.total, 2);
    assert.equal(res.changed, true);

    const data = readJson(dir);
    const character = data.find(e => e.url === '/library/assets/Character/lin_mo.png');
    const scene = data.find(e => e.url === '/library/assets/Scene/clip.mp4');
    assert.ok(character);
    assert.equal(character.category, 'Character');
    assert.equal(character.type, 'image');
    assert.equal(character.name, 'lin_mo');
    assert.ok(character.id);
    assert.equal(scene.type, 'video');
});

test('忽略非图片/视频文件（json、音频、说明文档）', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Others'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Others', 'note.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'Others', 'bgm.mp3'), 'x');
    fs.writeFileSync(path.join(dir, 'Others', 'ok.jpg'), 'x');

    const res = scanAssetLibrary(dir, { logger: silent });
    assert.equal(res.total, 1);
    const data = readJson(dir);
    assert.equal(data.length, 1);
    assert.equal(data[0].url, '/library/assets/Others/ok.jpg');
});

test('保留已有条目的 id/name/createdAt，不因再次扫描而变化', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Character'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Character', 'hero.png'), 'x');

    scanAssetLibrary(dir, { logger: silent });
    const first = readJson(dir)[0];

    // 第二次扫描（无文件变化）应保持稳定且不写盘
    const res = scanAssetLibrary(dir, { logger: silent });
    assert.equal(res.changed, false);
    assert.equal(res.added, 0);
    const second = readJson(dir)[0];
    assert.equal(second.id, first.id);
    assert.equal(second.name, first.name);
    assert.equal(second.createdAt, first.createdAt);
});

test('自定义 name 在扫描后被保留', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Character'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Character', 'hero.png'), 'x');
    scanAssetLibrary(dir, { logger: silent });

    // 用户在 app 里改过名字
    const data = readJson(dir);
    data[0].name = '男主·林默';
    fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(data, null, 2));

    scanAssetLibrary(dir, { logger: silent });
    assert.equal(readJson(dir)[0].name, '男主·林默');
});

test('清理磁盘上已删除文件对应的死条目', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Character'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Character', 'a.png'), 'x');
    fs.writeFileSync(path.join(dir, 'Character', 'b.png'), 'x');
    scanAssetLibrary(dir, { logger: silent });

    fs.unlinkSync(path.join(dir, 'Character', 'b.png'));
    const res = scanAssetLibrary(dir, { logger: silent });
    assert.equal(res.removed, 1);
    assert.equal(res.total, 1);
    assert.equal(readJson(dir).length, 1);
    assert.equal(readJson(dir)[0].url, '/library/assets/Character/a.png');
});

test('文件夹名变化时同步 category', () => {
    const dir = makeAssetsDir();
    fs.mkdirSync(path.join(dir, 'Character'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Character', 'x.png'), 'x');
    scanAssetLibrary(dir, { logger: silent });

    // 同名文件挪到另一分类
    fs.mkdirSync(path.join(dir, 'Scene'), { recursive: true });
    fs.renameSync(path.join(dir, 'Character', 'x.png'), path.join(dir, 'Scene', 'x.png'));

    scanAssetLibrary(dir, { logger: silent });
    const data = readJson(dir);
    assert.equal(data.length, 1);
    assert.equal(data[0].category, 'Scene');
    assert.equal(data[0].url, '/library/assets/Scene/x.png');
});

test('缺失目录时安全返回，不抛错', () => {
    const res = scanAssetLibrary(path.join(os.tmpdir(), 'nonexistent-assets-dir-xyz'), { logger: silent });
    assert.deepEqual(res, { added: 0, removed: 0, total: 0, changed: false });
});
