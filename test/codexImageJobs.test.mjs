import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import test from 'node:test';
import {
    claimCodexImageJob,
    completeCodexImageJob,
    createCodexImageJob,
    failCodexImageJob,
    getCodexImageJob,
    inspectCodexImageOutput,
    listCodexImageJobs
} from '../server/services/codexImageJobs.js';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-codex-jobs-'));
    const libraryDir = path.join(root, 'library');
    const imagesDir = path.join(libraryDir, 'images');
    const jobsDir = path.join(libraryDir, 'codex-image-jobs');
    fs.mkdirSync(imagesDir, { recursive: true });
    return { root, libraryDir, imagesDir, jobsDir };
}

test('creates versioned jobs and freezes library reference images', t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    fs.writeFileSync(path.join(dirs.imagesDir, 'character.png'), Buffer.from('reference'));
    const first = createCodexImageJob({
        ...dirs,
        nodeId: 'node-1',
        prompt: '古风漫画角色站在雨中',
        aspectRatio: '16:9',
        referenceImages: ['/library/images/character.png?t=123']
    });
    const second = createCodexImageJob({
        ...dirs,
        nodeId: 'node-1',
        prompt: '古风漫画角色站在雨中，镜头更近'
    });

    assert.equal(first.status, 'pending');
    assert.equal(first.aspectRatio, '16:9');
    assert.equal(first.outputSpec.enforceExactAspectRatio, false);
    assert.match(first.outputSpec.instruction, /Prefer a landscape image/);
    assert.equal(first.attempt, 1);
    assert.equal(second.attempt, 2);
    assert.equal(first.references.length, 1);
    assert.equal(fs.readFileSync(first.references[0].filePath, 'utf8'), 'reference');
    assert.deepEqual(listCodexImageJobs(dirs.jobsDir, 'pending').map(job => job.id), [first.id, second.id]);
});

test('claims and completes a job without overwriting another attempt', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const first = createCodexImageJob({ ...dirs, nodeId: 'node/unsafe', prompt: '第一版' });
    const second = createCodexImageJob({ ...dirs, nodeId: 'node/unsafe', prompt: '第二版' });
    const sourceOne = path.join(dirs.root, 'generated-one.png');
    const sourceTwo = path.join(dirs.root, 'generated-two.png');
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(sourceOne);
    await sharp({ create: { width: 80, height: 48, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toFile(sourceTwo);

    assert.equal(claimCodexImageJob(dirs.jobsDir, first.id).status, 'processing');
    const completedOne = await completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: first.id,
        sourceImage: sourceOne
    });
    const completedTwo = await completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: second.id,
        sourceImage: sourceTwo
    });

    assert.equal(completedOne.status, 'completed');
    assert.equal(completedTwo.status, 'completed');
    assert.notEqual(completedOne.resultUrl, completedTwo.resultUrl);
    assert.deepEqual(await sharp(completedOne.resultPath).metadata().then(({ width, height }) => ({ width, height })), { width: 64, height: 64 });
    assert.deepEqual(await sharp(completedTwo.resultPath).metadata().then(({ width, height }) => ({ width, height })), { width: 80, height: 48 });
    assert.equal(getCodexImageJob(dirs.jobsDir, first.id).resultUrl, completedOne.resultUrl);
});

test('removes frozen references after success but preserves them after failure', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const reference = path.join(dirs.imagesDir, 'character.png');
    fs.writeFileSync(reference, Buffer.from('reference'));
    const successful = createCodexImageJob({
        ...dirs,
        nodeId: 'successful-node',
        prompt: '成功任务',
        referenceImages: ['/library/images/character.png']
    });
    const failed = createCodexImageJob({
        ...dirs,
        nodeId: 'failed-node',
        prompt: '失败任务',
        referenceImages: ['/library/images/character.png']
    });
    const successfulReferenceDir = path.dirname(successful.references[0].filePath);
    const failedReferenceDir = path.dirname(failed.references[0].filePath);
    const source = path.join(dirs.root, 'generated.png');
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toFile(source);

    const completed = await completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: successful.id,
        sourceImage: source
    });
    failCodexImageJob(dirs.jobsDir, failed.id, '生成失败');

    assert.equal(fs.existsSync(successfulReferenceDir), false);
    assert.equal(fs.existsSync(failedReferenceDir), true);
    assert.ok(completed.referenceFilesCleanedAt);
    assert.ok(getCodexImageJob(dirs.jobsDir, successful.id).referenceFilesCleanedAt);
});

test('records but preserves ignored Codex aspect ratios', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const job = createCodexImageJob({
        ...dirs,
        nodeId: 'portrait-node',
        prompt: '全身人物定妆照',
        aspectRatio: '4:5'
    });
    const source = path.join(dirs.root, 'wrong-ratio.png');
    await sharp({
        create: {
            width: 90,
            height: 176,
            channels: 3,
            background: { r: 80, g: 90, b: 100 }
        }
    }).png().toFile(source);

    const before = await inspectCodexImageOutput({ imagePath: source, aspectRatio: job.aspectRatio });
    assert.equal(before.matches, false);

    const completed = await completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: job.id,
        sourceImage: source
    });
    const after = await inspectCodexImageOutput({ imagePath: completed.resultPath, aspectRatio: job.aspectRatio });

    assert.equal(after.matches, false);
    assert.deepEqual({ width: after.width, height: after.height }, { width: 90, height: 176 });
    assert.equal(completed.aspectRatioVerified, true);
    assert.equal(completed.aspectRatioAdjusted, false);
    assert.equal(completed.aspectRatioAdjustmentMode, 'accepted-source-ratio');
    assert.deepEqual(completed.sourceDimensions, { width: 90, height: 176 });
    assert.deepEqual(completed.outputDimensions, { width: 90, height: 176 });
});
