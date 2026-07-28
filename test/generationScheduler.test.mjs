import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GenerationJobJournal } from '../server/services/generationRuntime/jobJournal.js';
import { GenerationProviderRegistry } from '../server/services/generationRuntime/providerRegistry.js';
import { GenerationScheduler } from '../server/services/generationRuntime/scheduler.js';

const PROVIDERS = ['google-flow', 'gemini-web', 'jimeng'];

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function runtimeFixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-generation-scheduler-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let nextId = 0;
    const journal = new GenerationJobJournal({
        filePath: path.join(directory, 'jobs.json'),
        idFactory: () => `job-${++nextId}`
    });
    const registry = new GenerationProviderRegistry(PROVIDERS.map(id => ({
        id,
        label: id,
        transport: 'test',
        submitConcurrency: 1,
        pollConcurrency: 2,
        downloadConcurrency: 2
    })));
    const scheduler = new GenerationScheduler({
        registry,
        journal,
        globalSubmitConcurrency: 2,
        globalPollConcurrency: 3,
        globalDownloadConcurrency: 3
    });
    return { scheduler, journal };
}

function updatePeak(book, key, delta) {
    book.active[key] = (book.active[key] || 0) + delta;
    book.peak[key] = Math.max(book.peak[key] || 0, book.active[key]);
}

test('60 个合成任务压力测试：同平台提交串行、跨平台最多两个、轮询下载有界', async t => {
    const { scheduler, journal } = runtimeFixture(t);
    const submit = { active: { global: 0 }, peak: { global: 0 } };
    const poll = { active: { global: 0 }, peak: { global: 0 } };
    const download = { active: { global: 0 }, peak: { global: 0 } };

    const tasks = Array.from({ length: 60 }, (unused, index) => {
        const provider = PROVIDERS[index % PROVIDERS.length];
        return scheduler.run({
            provider,
            label: `stress-${index}`,
            metadata: { kind: index % 2 ? 'video' : 'image', modelId: `${provider}-test` },
            task: async () => {
                updatePeak(submit, provider, 1);
                updatePeak(submit, 'global', 1);
                await delay(3);
                scheduler.noteBillableRequestStart(provider);
                scheduler.noteBillableRequestSettled(provider, { submitId: `submit-${index}` });
                updatePeak(submit, provider, -1);
                updatePeak(submit, 'global', -1);

                await scheduler.runStage({
                    provider,
                    stage: 'poll',
                    label: `poll-${index}`,
                    task: async () => {
                        updatePeak(poll, provider, 1);
                        updatePeak(poll, 'global', 1);
                        await delay(2);
                        updatePeak(poll, provider, -1);
                        updatePeak(poll, 'global', -1);
                    }
                });
                await scheduler.runStage({
                    provider,
                    stage: 'download',
                    label: `download-${index}`,
                    task: async () => {
                        updatePeak(download, provider, 1);
                        updatePeak(download, 'global', 1);
                        await delay(2);
                        updatePeak(download, provider, -1);
                        updatePeak(download, 'global', -1);
                    }
                });
                return index;
            }
        });
    });

    assert.deepEqual(await Promise.all(tasks), Array.from({ length: 60 }, (unused, index) => index));
    assert.equal(submit.peak.global, 2, '跨平台提交临界区应能并行但不得超过 2');
    for (const provider of PROVIDERS) {
        assert.equal(submit.peak[provider], 1, `${provider} 提交前临界区发生并发`);
        assert.ok(poll.peak[provider] <= 2, `${provider} 轮询超过平台上限`);
        assert.ok(download.peak[provider] <= 2, `${provider} 下载超过平台上限`);
    }
    assert.ok(poll.peak.global <= 3, '全局轮询超过上限');
    assert.ok(download.peak.global <= 3, '全局下载超过上限');
    assert.deepEqual(journal.summary().counts, { completed: 60 });
    assert.equal(scheduler.snapshot().activeJobs.length, 0);
});

test('平台确认提交后立即交棒，同平台下一任务无需等待前一任务轮询结束', async t => {
    const { scheduler } = runtimeFixture(t);
    const firstSubmitted = deferred();
    const finishFirst = deferred();
    const secondStarted = deferred();

    const first = scheduler.run({
        provider: 'jimeng',
        label: 'first',
        task: async () => {
            scheduler.noteBillableRequestStart('jimeng');
            scheduler.noteBillableRequestSettled('jimeng', { submitId: 'first-submit' });
            firstSubmitted.resolve();
            await finishFirst.promise;
            return 'first';
        }
    });
    await firstSubmitted.promise;

    const second = scheduler.run({
        provider: 'jimeng',
        label: 'second',
        task: async () => {
            secondStarted.resolve();
            scheduler.noteBillableRequestStart('jimeng');
            scheduler.noteBillableRequestSettled('jimeng', { submitId: 'second-submit' });
            return 'second';
        }
    });

    await Promise.race([
        secondStarted.promise,
        delay(200).then(() => { throw new Error('第二个同平台任务未在提交交棒后启动'); })
    ]);
    assert.equal(await second, 'second');
    finishFirst.resolve();
    assert.equal(await first, 'first');
});

test('排队期间取消不会进入平台，提交后取消会保留恢复状态', async t => {
    const { scheduler, journal } = runtimeFixture(t);
    const releaseFirst = deferred();
    const firstStarted = deferred();
    const first = scheduler.run({
        provider: 'google-flow',
        label: 'blocking',
        task: async () => {
            firstStarted.resolve();
            await releaseFirst.promise;
            return 'done';
        }
    });
    await firstStarted.promise;

    const controller = new AbortController();
    let queuedStarted = false;
    const queued = scheduler.run({
        provider: 'google-flow',
        label: 'cancel-before-submit',
        signal: controller.signal,
        task: async () => { queuedStarted = true; }
    });
    controller.abort();
    await assert.rejects(queued, error => {
        assert.equal(error.code, 'OPERATION_CANCELLED');
        assert.equal(error.submitted, false);
        return true;
    });
    assert.equal(queuedStarted, false);
    releaseFirst.resolve();
    await first;

    const afterSubmitController = new AbortController();
    await assert.rejects(scheduler.run({
        provider: 'gemini-web',
        label: 'cancel-after-submit',
        signal: afterSubmitController.signal,
        task: async () => {
            scheduler.noteBillableRequestStart('gemini-web');
            scheduler.noteBillableRequestSettled('gemini-web', { conversationId: 'c_11111111aaaaaaaa' });
            afterSubmitController.abort();
            await scheduler.runStage({
                provider: 'gemini-web',
                stage: 'poll',
                label: 'cancelled-poll',
                signal: afterSubmitController.signal,
                task: async () => {}
            });
        }
    }), error => {
        assert.equal(error.code, 'OPERATION_CANCELLED');
        assert.equal(error.submitted, true);
        assert.equal(error.retryable, false);
        return true;
    });

    const byLabel = Object.fromEntries(journal.list({ limit: 20 }).map(job => [job.label, job]));
    assert.equal(byLabel['cancel-before-submit'].state, 'cancelled');
    assert.equal(byLabel['cancel-after-submit'].state, 'recovery_required');
    assert.equal(byLabel['cancel-after-submit'].details.conversationId, 'c_11111111aaaaaaaa');
});

test('计费请求传输结果未知时进入 submission_unknown，不伪装成普通失败', async t => {
    const { scheduler, journal } = runtimeFixture(t);
    await assert.rejects(scheduler.run({
        provider: 'jimeng',
        label: 'transport-unknown',
        task: async () => {
            scheduler.noteBillableRequestStart('jimeng');
            scheduler.noteBillableRequestSettled('jimeng', { submitId: 'local-submit-id' }, { unknown: true });
            const error = new Error('子进程中断');
            error.code = 'BRIDGE_UNAVAILABLE';
            error.submitted = true;
            throw error;
        }
    }), /子进程中断/);

    const job = journal.list().find(item => item.label === 'transport-unknown');
    assert.equal(job.state, 'submission_unknown');
    assert.equal(job.details.submitId, 'local-submit-id');
});

test('任务日志重启后区分安全重跑与需人工核对，并且不落凭证和提示词', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-generation-journal-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'jobs.json');
    let nextId = 0;
    let tick = 0;
    const options = {
        filePath,
        idFactory: () => `persistent-${++nextId}`,
        now: () => new Date(Date.UTC(2026, 6, 28, 0, 0, tick++)).toISOString()
    };
    const firstProcess = new GenerationJobJournal(options);
    const safe = firstProcess.create({
        provider: 'jimeng',
        label: 'safe-retry',
        metadata: {
            kind: 'image',
            modelId: 'jimeng-image-5-0-lite',
            nodeId: 'node-safe',
            workflowId: 'workflow-safe',
            prompt: '不得落盘的提示词'
        }
    });
    firstProcess.transition(safe.id, 'preparing');
    const unknown = firstProcess.create({ provider: 'google-flow', label: 'check-history' });
    firstProcess.transition(unknown.id, 'submitted', {
        details: { batchId: 'batch-safe', accessToken: 'secret-must-not-persist' }
    });
    firstProcess.transition(unknown.id, 'polling');
    const failed = firstProcess.create({ provider: 'gemini-web', label: 'redacted-error' });
    firstProcess.transition(failed.id, 'failed', {
        error: 'authorization: Bearer abcdefghijklmnopqrstuvwxyz cookie: SID=abcdef123456'
    });

    const secondProcess = new GenerationJobJournal({ ...options, idFactory: () => 'unused' });
    const byLabel = Object.fromEntries(secondProcess.list().map(job => [job.label, job]));
    assert.equal(byLabel['safe-retry'].state, 'interrupted');
    assert.equal(byLabel['safe-retry'].metadata.nodeId, 'node-safe');
    assert.equal(byLabel['safe-retry'].metadata.workflowId, 'workflow-safe');
    assert.equal(byLabel['check-history'].state, 'recovery_required');
    assert.equal(byLabel['check-history'].details.batchId, 'batch-safe');
    assert.equal(byLabel['redacted-error'].state, 'failed');

    const raw = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(raw, /不得落盘的提示词|secret-must-not-persist|abcdefghijklmnopqrstuvwxyz|abcdef123456/);
    assert.match(raw, /authorization: \*\*\*/i);
});
