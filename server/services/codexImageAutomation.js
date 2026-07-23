import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { failCodexImageJob, listCodexImageJobs } from './codexImageJobs.js';
import { resolveCodexBin } from './cliPaths.js';

const ACTIVE_STATUSES = new Set(['pending', 'processing']);
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOG_FILES = 10;

export function pruneCodexAutomationLogs(
    automationDir,
    { now = Date.now(), maxAgeMs = LOG_RETENTION_MS, maxFiles = MAX_LOG_FILES } = {}
) {
    if (!fs.existsSync(automationDir)) return [];

    const logs = fs.readdirSync(automationDir)
        .filter(filename => /^worker-.*\.log$/.test(filename))
        .map(filename => {
            const filePath = path.join(automationDir, filename);
            return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const removed = [];
    logs.forEach((log, index) => {
        if (now - log.mtimeMs <= maxAgeMs && index < maxFiles) return;
        fs.rmSync(log.filePath, { force: true });
        removed.push(log.filePath);
    });
    return removed;
}

export function buildCodexAutomationCommand(projectRoot, codexPath) {
    const command = resolveCodexBin({ projectRoot, configuredPath: codexPath });
    const prompt = [
        '使用 twitcanva-codex-images skill，自动处理当前 Evan 项目中的全部图片生成任务。',
        '先恢复 processing 任务，再按创建时间处理 pending 任务，直到连续两次检查队列都为空。',
        '必须使用当前 ChatGPT 登录包含的内置 image_gen 能力，不调用 OpenAI API，也不要索要 API Key。',
        '严格只操作 library/codex-image-jobs、library/projects 下当前项目素材目录及兼容的 library/images，不修改项目源代码，不等待用户输入。'
    ].join('\n');

    return {
        command,
        args: [
            'exec',
            '--ephemeral',
            '-C', projectRoot,
            '-s', 'workspace-write',
            '--color', 'never',
            prompt
        ]
    };
}

export function createCodexImageAutomation({
    projectRoot,
    jobsDir,
    codexPath,
    enabled = process.env.CODEX_IMAGE_AUTOMATION !== 'false',
    spawnProcess = spawn,
    maxAttempts = 3,
    retryDelayMs = 3000,
    timeoutMs = 30 * 60 * 1000
}) {
    const automationDir = path.join(jobsDir, 'automation');
    const commandSpec = buildCodexAutomationCommand(projectRoot, codexPath);
    let child = null;
    let scheduled = false;
    let retryTimer = null;
    let runAttempts = 0;
    let state = {
        enabled,
        status: enabled ? 'idle' : 'disabled',
        command: commandSpec.command,
        pid: null,
        startedAt: null,
        finishedAt: null,
        lastExitCode: null,
        lastError: null,
        logFile: null
    };

    const getActiveJobs = () => listCodexImageJobs(jobsDir)
        .filter(job => ACTIVE_STATUSES.has(job.status));

    const failActiveJobs = message => {
        getActiveJobs().forEach(job => {
            try {
                failCodexImageJob(jobsDir, job.id, message);
            } catch (error) {
                console.error(`[Codex 自动生图] 标记任务失败时出错：${error.message}`);
            }
        });
    };

    const scheduleRun = delay => {
        if (!enabled || child || scheduled || retryTimer) return;
        scheduled = true;
        const start = () => {
            scheduled = false;
            retryTimer = null;
            run();
        };
        if (delay > 0) {
            retryTimer = setTimeout(start, delay);
            retryTimer.unref?.();
        } else {
            queueMicrotask(start);
        }
    };

    const finishRun = (exitCode, errorMessage) => {
        child = null;
        state = {
            ...state,
            status: errorMessage ? 'error' : 'idle',
            pid: null,
            finishedAt: new Date().toISOString(),
            lastExitCode: exitCode,
            lastError: errorMessage || null
        };

        const activeJobs = getActiveJobs();
        if (activeJobs.length === 0) {
            runAttempts = 0;
            return;
        }

        if (runAttempts < maxAttempts) {
            console.warn(`[Codex 自动生图] 仍有 ${activeJobs.length} 个任务未完成，准备第 ${runAttempts + 1} 次尝试`);
            scheduleRun(retryDelayMs);
            return;
        }

        const reason = errorMessage || `Codex 自动处理连续 ${maxAttempts} 次未完成`;
        failActiveJobs(`${reason}。请确认 ChatGPT 已登录后重新点击生成。`);
        state = { ...state, status: 'error', lastError: reason };
        runAttempts = 0;
    };

    const run = () => {
        if (!enabled || child || getActiveJobs().length === 0) return;

        fs.mkdirSync(automationDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = path.join(automationDir, `worker-${timestamp}.log`);
        const logFd = fs.openSync(logFile, 'a');
        try {
            pruneCodexAutomationLogs(automationDir);
        } catch (error) {
            console.warn(`[Codex 自动生图] 清理旧日志失败：${error.message}`);
        }
        runAttempts += 1;
        state = {
            ...state,
            status: 'running',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            lastExitCode: null,
            lastError: null,
            logFile
        };

        let settled = false;
        let timeout;
        try {
            child = spawnProcess(commandSpec.command, commandSpec.args, {
                cwd: projectRoot,
                env: process.env,
                stdio: ['ignore', logFd, logFd]
            });
            state = { ...state, pid: child.pid || null };
            console.log(`[Codex 自动生图] 已启动 ChatGPT Plus worker${child.pid ? `，PID ${child.pid}` : ''}`);

            timeout = setTimeout(() => {
                if (settled || !child) return;
                child.kill?.('SIGTERM');
                settle(null, `Codex 自动生图超过 ${Math.round(timeoutMs / 60000)} 分钟`);
            }, timeoutMs);
            timeout.unref?.();

            const settle = (code, message) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                fs.closeSync(logFd);
                finishRun(code, message);
            };

            child.once('error', error => settle(null, `无法启动 Codex：${error.message}`));
            child.once('close', code => settle(code, code === 0 ? null : `Codex 进程退出码 ${code}`));
        } catch (error) {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                fs.closeSync(logFd);
                finishRun(null, `无法启动 Codex：${error.message}`);
            }
        }
    };

    return {
        notify() {
            if (!enabled) return false;
            runAttempts = 0;
            scheduleRun(0);
            return true;
        },
        resumePending() {
            if (!enabled || getActiveJobs().length === 0) return false;
            scheduleRun(0);
            return true;
        },
        getStatus() {
            return { ...state, queuedJobs: getActiveJobs().length };
        }
    };
}
