import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { failCodexImageJob, listCodexImageJobs } from './codexImageJobs.js';
import { resolveCodexBin } from './cliPaths.js';

const ACTIVE_STATUSES = new Set(['pending', 'processing']);
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOG_FILES = 10;

function windowsCommandLine(command, args) {
    const quote = value => `"${String(value).replaceAll('"', '""')}"`;
    return [quote(command), ...args.map(quote)].join(' ');
}

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

/**
 * worker 日志的最后一条有效输出，用来补全"退出码 N"这种无从下手的报错。
 *
 * codex 失败时真正的原因只写在日志里（例：Not inside a trusted directory…），
 * 前端只拿到退出码，排查得先去 userData 里翻文件。
 */
export function readCodexFailureReason(logFile, { maxChars = 200 } = {}) {
    if (!logFile) return '';
    let text = '';
    try {
        text = fs.readFileSync(logFile, 'utf8');
    } catch {
        return '';
    }
    const lines = text.split(/\r?\n/)
        .map(line => line.trim())
        // 这行是 codex 读 stdin 的例行提示，不是失败原因。
        .filter(line => line && line !== 'Reading additional input from stdin...');
    const reason = lines.at(-1) || '';
    return reason.length > maxChars ? `${reason.slice(0, maxChars)}…` : reason;
}

function isInside(parentDir, childDir) {
    const relative = path.relative(parentDir, childDir);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * 需要额外授予 codex 写权限的目录（`--add-dir`）。
 *
 * codex exec 的 workspace-write 沙箱只放开 workdir（userData/data）、/tmp 和
 * $TMPDIR。项目素材目录可以是指向沙箱外的符号链接（例：
 * library/projects/<名字> -> ~/Desktop/<名字>），这时桥接命令把生成图复制进项目
 * 素材目录会拿到 EPERM，任务被标记失败 —— 图其实已经生成好了。
 *
 * 沙箱按解析后的真实路径匹配，所以这里必须给 realpath，给符号链接本身没有用。
 * 只放开确实落在沙箱外的目录：其余的本来就可写，重复声明没有意义。
 */
export function resolveExtraWritableRoots({
    libraryDir,
    workspaceDir,
    realpath = fs.realpathSync,
    readdir = fs.readdirSync,
    stat = fs.statSync
} = {}) {
    if (!libraryDir || !workspaceDir) return [];

    let resolvedWorkspace = workspaceDir;
    try {
        resolvedWorkspace = realpath(workspaceDir);
    } catch {
        // 目录还不存在时按原样比较即可。
    }

    const candidates = [libraryDir, path.join(libraryDir, 'projects')];
    try {
        const projectsDir = path.join(libraryDir, 'projects');
        for (const entry of readdir(projectsDir)) {
            candidates.push(path.join(projectsDir, entry));
        }
    } catch {
        // 还没有任何项目目录。
    }

    const roots = [];
    for (const candidate of candidates) {
        let resolved;
        try {
            resolved = realpath(candidate);
            if (!stat(resolved).isDirectory()) continue;
        } catch {
            continue;
        }
        if (isInside(resolvedWorkspace, resolved)) continue;
        // 已经被父目录覆盖的就不再重复声明。
        if (roots.some(root => isInside(root, resolved))) continue;
        roots.push(resolved);
    }
    return roots;
}

export function buildCodexAutomationCommand(
    projectRoot,
    codexPath,
    queueCommand = '',
    { libraryDir = '', extraWritableRoots } = {}
) {
    const command = resolveCodexBin({ projectRoot, configuredPath: codexPath });
    const prompt = [
        '使用 twitcanva-codex-images skill，自动处理当前 Evan 项目中的全部图片生成任务。',
        '先恢复 processing 任务，再按创建时间处理 pending 任务，直到连续两次检查队列都为空。',
        '必须使用当前 ChatGPT 登录包含的内置 image_gen 能力，不调用 OpenAI API，也不要索要 API Key。',
        queueCommand ? `Evan 队列桥接命令为：${queueCommand}` : '',
        '严格只操作 library/codex-image-jobs、library/projects 下当前项目素材目录及兼容的 library/images，不修改项目源代码，不等待用户输入。'
    ].filter(Boolean).join('\n');

    const writableRoots = extraWritableRoots
        || resolveExtraWritableRoots({ libraryDir, workspaceDir: projectRoot });

    return {
        command,
        args: [
            'exec',
            '--ephemeral',
            // 项目素材目录可能是指向沙箱外的符号链接，不放开就写不进去（EPERM）。
            ...writableRoots.flatMap(root => ['--add-dir', root]),
            // 工作目录是 userData/data（放 library、codex-home 的地方），永远不是 git 仓库。
            // 少了这个参数，codex exec 直接拒绝启动：
            //   Not inside a trusted directory and --skip-git-repo-check was not specified.
            // 退出码 1、什么也没做，前端只看到"Codex 进程退出码 1"。
            // 提示词优化那条路径（promptOptimizerProviders.runCodexCli）一直带着它。
            '--skip-git-repo-check',
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
    workspaceDir = projectRoot,
    commandEnvironment = () => process.env,
    platform = process.platform,
    enabled = process.env.CODEX_IMAGE_AUTOMATION !== 'false',
    spawnProcess = spawn,
    maxAttempts = 3,
    retryDelayMs = 3000,
    timeoutMs = 30 * 60 * 1000
}) {
    const automationDir = path.join(jobsDir, 'automation');
    const resolveCommandSpec = () => {
        const environment = typeof commandEnvironment === 'function'
            ? commandEnvironment()
            : commandEnvironment;
        return buildCodexAutomationCommand(
            workspaceDir,
            typeof codexPath === 'function' ? codexPath() : codexPath,
            environment?.EVAN_CODEX_QUEUE || '',
            // 每次运行都重新解析：期间新建或重新链接的项目目录都能覆盖到。
            { libraryDir: environment?.EVAN_LIBRARY_DIR || '' }
        );
    };
    const initialCommandSpec = resolveCommandSpec();
    let child = null;
    let scheduled = false;
    let retryTimer = null;
    let runAttempts = 0;
    let state = {
        enabled,
        status: enabled ? 'idle' : 'disabled',
        command: initialCommandSpec.command,
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

        const commandSpec = resolveCommandSpec();
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
            command: commandSpec.command,
            logFile
        };

        let settled = false;
        let timeout;
        try {
            const environment = typeof commandEnvironment === 'function'
                ? commandEnvironment()
                : commandEnvironment;
            const isWindowsScript = platform === 'win32' && /\.(?:cmd|bat)$/i.test(commandSpec.command);
            const spawnCommand = isWindowsScript
                ? (environment.ComSpec || 'cmd.exe')
                : commandSpec.command;
            const spawnArgs = isWindowsScript
                ? ['/d', '/s', '/c', windowsCommandLine(commandSpec.command, commandSpec.args)]
                : commandSpec.args;
            child = spawnProcess(spawnCommand, spawnArgs, {
                cwd: workspaceDir,
                env: environment,
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
            child.once('close', code => {
                if (code === 0) return settle(code, null);
                const reason = readCodexFailureReason(logFile);
                settle(code, reason
                    ? `Codex 进程退出码 ${code}：${reason}`
                    : `Codex 进程退出码 ${code}`);
            });
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
