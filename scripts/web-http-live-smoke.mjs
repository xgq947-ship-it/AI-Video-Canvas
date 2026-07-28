#!/usr/bin/env node

/**
 * Manual, opt-in end-to-end smoke runner for the three browser-authenticated
 * HTTP providers. Merely running this file prints the matrix and performs no
 * network request. Real generation requires both `--execute` and
 * `EVAN_LIVE_SMOKE=1`, plus an explicit selector or `--all`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    IMAGE_GENERATION_PROVIDERS,
    VIDEO_GENERATION_PROVIDERS
} from '../shared/generationProviders.js';

const WEB_PROVIDERS = new Set(['google-flow', 'gemini-web', 'jimeng']);

function concrete(values, fallback) {
    return (values || []).find(value => !['auto', '自动'].includes(String(value).toLowerCase())) || fallback;
}

export function buildLiveSmokeMatrix() {
    const cases = [];
    for (const model of IMAGE_GENERATION_PROVIDERS.filter(item => WEB_PROVIDERS.has(item.browserProvider))) {
        const common = {
            provider: model.browserProvider,
            kind: 'image',
            modelId: model.id,
            aspectRatio: concrete(model.supportedAspectRatios, '1:1'),
            resolution: concrete(model.resolutions, undefined),
            quotaClass: model.id === 'jimeng-image-5-0-lite' ? 'free' : 'metered-or-account-dependent'
        };
        cases.push({ ...common, id: `image/${model.id}/text`, mode: 'text', referenceCount: 0, outputCount: 1 });
        if (model.supportsImageToImage && model.maxReferenceImages >= 1) {
            cases.push({ ...common, id: `image/${model.id}/reference`, mode: 'reference', referenceCount: 1, outputCount: 1 });
        }
        if (model.supportsMultipleReferenceImages && model.maxReferenceImages >= 2) {
            cases.push({ ...common, id: `image/${model.id}/multi-reference`, mode: 'multi-reference', referenceCount: 2, outputCount: 1 });
        }
        if (model.supportsMultipleOutputs && model.maxOutputCount >= 2) {
            cases.push({ ...common, id: `image/${model.id}/multi-output`, mode: 'multi-output', referenceCount: 0, outputCount: 2 });
        }
    }

    for (const model of VIDEO_GENERATION_PROVIDERS.filter(item => WEB_PROVIDERS.has(item.browserProvider))) {
        const common = {
            provider: model.browserProvider,
            kind: 'video',
            modelId: model.id,
            aspectRatio: concrete(model.supportedAspectRatios, '16:9'),
            resolution: concrete(model.resolutions, undefined),
            duration: model.supportedDurations?.[0],
            generateAudio: model.supportsNativeAudio !== false,
            quotaClass: 'metered-or-account-dependent',
            outputCount: 1
        };
        if (model.supportsTextToVideo) {
            cases.push({ ...common, id: `video/${model.id}/text`, mode: 'text', referenceCount: 0 });
        }
        if (model.supportsImageToVideo && model.maxReferenceImages >= 1) {
            cases.push({ ...common, id: `video/${model.id}/reference`, mode: 'reference', referenceCount: 1 });
        }
        if (model.supportsImageToVideo && model.supportsMultipleReferenceImages && model.maxReferenceImages >= 2) {
            cases.push({ ...common, id: `video/${model.id}/multi-reference`, mode: 'multi-reference', referenceCount: 2 });
        }
    }
    return cases;
}

export function assertLiveExecutionGate({ execute, environment = process.env, selectionExplicit }) {
    if (!execute) return;
    if (environment.EVAN_LIVE_SMOKE !== '1') {
        throw new Error('真实冒烟被安全锁阻止：请同时设置 EVAN_LIVE_SMOKE=1');
    }
    if (!selectionExplicit) {
        throw new Error('真实冒烟必须显式指定 --case/--provider/--model/--kind/--mode，或使用 --all');
    }
}

function mimeTypeFor(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.gif') return 'image/gif';
    return 'image/png';
}

export function resolveReferenceInput(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('参考图路径不能为空');
    if (/^data:image\//i.test(input) || /^https?:\/\//i.test(input) || input.startsWith('/library/')) {
        return input;
    }
    const filePath = path.resolve(input);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`参考图不是文件：${filePath}`);
    return `data:${mimeTypeFor(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

export function buildSmokePayload(testCase, { workflowId, references = [], runId = Date.now() } = {}) {
    if (!workflowId) throw new Error('真实冒烟必须提供已有项目的 --workflow-id');
    if (references.length < testCase.referenceCount) {
        throw new Error(`${testCase.id} 需要 ${testCase.referenceCount} 张参考图，当前只有 ${references.length} 张`);
    }
    const selectedReferences = references.slice(0, testCase.referenceCount);
    const prompt = testCase.kind === 'image'
        ? `[Evan HTTP 冒烟测试] ${testCase.id}：生成构图清晰、无文字的简洁静物图。`
        : `[Evan HTTP 冒烟测试] ${testCase.id}：主体做轻微自然运动，镜头稳定，无字幕。`;
    const common = {
        workflowId,
        nodeId: `web-http-smoke-${String(runId)}-${testCase.id.replace(/[^a-z0-9]+/gi, '-')}`,
        prompt,
        aspectRatio: testCase.aspectRatio,
        ...(testCase.resolution ? { resolution: testCase.resolution } : {})
    };
    if (testCase.kind === 'image') {
        return {
            endpoint: '/api/generate-image',
            body: {
                ...common,
                imageModel: testCase.modelId,
                count: testCase.outputCount,
                ...(selectedReferences.length ? { imageBase64: selectedReferences } : {})
            }
        };
    }
    return {
        endpoint: '/api/generate-video',
        body: {
            ...common,
            videoModel: testCase.modelId,
            duration: testCase.duration,
            generateAudio: testCase.generateAudio,
            ...(testCase.mode === 'reference' ? { imageBase64: selectedReferences[0] } : {}),
            ...(testCase.mode === 'multi-reference' ? {
                referenceImages: selectedReferences,
                referenceImageLabels: selectedReferences.map((unused, index) => `参考图${index + 1}`)
            } : {})
        }
    };
}

function parseArgs(argv) {
    const options = {
        baseUrl: 'http://127.0.0.1:3001',
        cases: [],
        references: [],
        timeoutMinutes: 20
    };
    const valueFlags = new Map([
        ['--base-url', 'baseUrl'], ['--case', 'cases'], ['--provider', 'provider'],
        ['--model', 'model'], ['--kind', 'kind'], ['--mode', 'mode'],
        ['--reference', 'references'], ['--workflow-id', 'workflowId'],
        ['--timeout-minutes', 'timeoutMinutes'], ['--report', 'report']
    ]);
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === '--execute') options.execute = true;
        else if (token === '--all') options.all = true;
        else if (token === '--list') options.list = true;
        else if (token === '--help' || token === '-h') options.help = true;
        else if (valueFlags.has(token)) {
            const value = argv[++index];
            if (value === undefined) throw new Error(`${token} 缺少参数`);
            const key = valueFlags.get(token);
            if (Array.isArray(options[key])) options[key].push(value);
            else options[key] = key === 'timeoutMinutes' ? Number(value) : value;
        } else {
            throw new Error(`未知参数：${token}`);
        }
    }
    return options;
}

function selectCases(matrix, options) {
    const exactCases = new Set(options.cases);
    return matrix.filter(testCase => {
        if (exactCases.size && !exactCases.has(testCase.id)) return false;
        if (options.provider && testCase.provider !== options.provider) return false;
        if (options.model && testCase.modelId !== options.model) return false;
        if (options.kind && testCase.kind !== options.kind) return false;
        if (options.mode && testCase.mode !== options.mode) return false;
        return true;
    });
}

function printMatrix(cases) {
    console.log(`Web HTTP 冒烟矩阵：${cases.length} 项（当前仅列计划，不执行生成）`);
    for (const testCase of cases) {
        const quota = testCase.quotaClass === 'free' ? '即梦 5.0 Lite 免费' : '可能消耗额度';
        console.log(`- ${testCase.id} | ${testCase.provider} | 参考图 ${testCase.referenceCount} | 输出 ${testCase.outputCount} | ${quota}`);
    }
}

async function fetchJson(url, options, timeoutMs) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || `HTTP ${response.status}`);
        Object.assign(error, {
            status: response.status,
            code: payload.code,
            submitted: payload.submitted,
            retryable: payload.retryable,
            details: payload.details
        });
        throw error;
    }
    return payload;
}

async function verifyMedia(baseUrl, mediaUrl, expectedKind, timeoutMs) {
    const target = new URL(mediaUrl, baseUrl);
    const response = await fetch(target, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`结果文件不可读：${mediaUrl}（HTTP ${response.status}）`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith(`${expectedKind}/`)) {
        throw new Error(`结果类型错误：期望 ${expectedKind}，实际 ${contentType}`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength <= 0) throw new Error(`结果文件为空：${mediaUrl}`);
    return { url: mediaUrl, contentType, contentLength: Number.isFinite(contentLength) ? contentLength : null };
}

async function runLiveCases(cases, options) {
    const baseUrl = new URL(options.baseUrl).origin;
    const timeoutMs = Math.max(1, Number(options.timeoutMinutes) || 20) * 60_000;
    const references = options.references.map(resolveReferenceInput);
    const health = await fetchJson(
        `${baseUrl}/api/settings/provider-health?probe=1`,
        { method: 'GET' },
        Math.min(timeoutMs, 10 * 60_000)
    );
    if (health.overall === 'busy' || health.probeSkipped === 'generation-active') {
        throw new Error('当前已有生成任务，真实冒烟已停止；请等现有任务完成后再执行');
    }
    const selectedProviders = new Set(cases.map(testCase => testCase.provider));
    const healthByProvider = new Map((health.providers || []).map(provider => [provider.id, provider]));
    for (const providerId of selectedProviders) {
        const provider = healthByProvider.get(providerId);
        if (!provider) throw new Error(`健康接口没有返回 ${providerId} 状态`);
        if (provider.state !== 'healthy') {
            throw new Error(`${provider.label || provider.id} 健康检查未通过：${provider.message || provider.state}`);
        }
    }

    const report = {
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        baseUrl,
        workflowId: options.workflowId,
        cases: []
    };
    for (const [index, testCase] of cases.entries()) {
        console.log(`[${index + 1}/${cases.length}] 执行 ${testCase.id}`);
        const startedAt = Date.now();
        try {
            const request = buildSmokePayload(testCase, {
                workflowId: options.workflowId,
                references,
                runId: `${Date.now()}-${index + 1}`
            });
            const payload = await fetchJson(`${baseUrl}${request.endpoint}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(request.body)
            }, timeoutMs);
            const urls = testCase.kind === 'image'
                ? (Array.isArray(payload.resultUrls) ? payload.resultUrls : [payload.resultUrl]).filter(Boolean)
                : [payload.resultUrl].filter(Boolean);
            if (urls.length !== testCase.outputCount) {
                throw new Error(`结果数量错误：期望 ${testCase.outputCount}，实际 ${urls.length}`);
            }
            const media = [];
            for (const url of urls) media.push(await verifyMedia(baseUrl, url, testCase.kind, timeoutMs));
            report.cases.push({ id: testCase.id, status: 'passed', durationMs: Date.now() - startedAt, media });
        } catch (error) {
            report.cases.push({
                id: testCase.id,
                status: 'failed',
                durationMs: Date.now() - startedAt,
                error: error.message,
                code: error.code,
                submitted: error.submitted
            });
            report.finishedAt = new Date().toISOString();
            if (options.report) fs.writeFileSync(path.resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
            throw error;
        }
    }
    report.finishedAt = new Date().toISOString();
    if (options.report) fs.writeFileSync(path.resolve(options.report), `${JSON.stringify(report, null, 2)}\n`);
    return report;
}

function usage() {
    return `用法：
  npm run test:web-http:live -- --list [筛选条件]
  EVAN_LIVE_SMOKE=1 npm run test:web-http:live -- --execute --case <case-id> --workflow-id <已有项目ID> [--reference <图片>]
  EVAN_LIVE_SMOKE=1 npm run test:web-http:live -- --execute --all --workflow-id <已有项目ID> --reference <图片1> --reference <图片2>

筛选：--provider / --model / --kind image|video / --mode text|reference|multi-reference|multi-output
说明：真实执行严格串行、绝不自动重试；默认只打印矩阵。`;
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(usage());
        return null;
    }
    const matrix = buildLiveSmokeMatrix();
    const selected = selectCases(matrix, options);
    if (selected.length === 0) throw new Error('没有匹配的冒烟用例');
    const selectionExplicit = Boolean(options.all || options.cases.length || options.provider
        || options.model || options.kind || options.mode);
    assertLiveExecutionGate({ execute: options.execute, environment, selectionExplicit });
    if (!options.execute || options.list) {
        printMatrix(selected);
        return { cases: selected };
    }
    const report = await runLiveCases(selected, options);
    console.log(`真实冒烟完成：${report.cases.length}/${selected.length} 通过`);
    return report;
}

const isMain = process.argv[1]
    && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
    main().catch(error => {
        console.error(`Web HTTP 冒烟失败：${error.message}`);
        if (error.submitted === true) console.error('请求可能已经提交，先查平台历史，不要直接重跑。');
        process.exitCode = 1;
    });
}
