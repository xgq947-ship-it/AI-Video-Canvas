import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    claimCodexImageJob,
    completeCodexImageJob,
    createCodexImageJob,
    getCodexImageJob,
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
    assert.equal(first.attempt, 1);
    assert.equal(second.attempt, 2);
    assert.equal(first.references.length, 1);
    assert.equal(fs.readFileSync(first.references[0].filePath, 'utf8'), 'reference');
    assert.deepEqual(listCodexImageJobs(dirs.jobsDir, 'pending').map(job => job.id), [first.id, second.id]);
});

test('claims and completes a job without overwriting another attempt', t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));

    const first = createCodexImageJob({ ...dirs, nodeId: 'node/unsafe', prompt: '第一版' });
    const second = createCodexImageJob({ ...dirs, nodeId: 'node/unsafe', prompt: '第二版' });
    const sourceOne = path.join(dirs.root, 'generated-one.png');
    const sourceTwo = path.join(dirs.root, 'generated-two.png');
    fs.writeFileSync(sourceOne, Buffer.from('one'));
    fs.writeFileSync(sourceTwo, Buffer.from('two'));

    assert.equal(claimCodexImageJob(dirs.jobsDir, first.id).status, 'processing');
    const completedOne = completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: first.id,
        sourceImage: sourceOne
    });
    const completedTwo = completeCodexImageJob({
        jobsDir: dirs.jobsDir,
        imagesDir: dirs.imagesDir,
        jobId: second.id,
        sourceImage: sourceTwo
    });

    assert.equal(completedOne.status, 'completed');
    assert.equal(completedTwo.status, 'completed');
    assert.notEqual(completedOne.resultUrl, completedTwo.resultUrl);
    assert.equal(fs.readFileSync(completedOne.resultPath, 'utf8'), 'one');
    assert.equal(fs.readFileSync(completedTwo.resultPath, 'utf8'), 'two');
    assert.equal(getCodexImageJob(dirs.jobsDir, first.id).resultUrl, completedOne.resultUrl);
});
