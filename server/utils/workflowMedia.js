const DEFAULT_WORKFLOW_MEDIA_TIMEOUT_MS = 30_000;

function resultRecoveryMessage(providerName, detail, recoveryHint) {
    return `${providerName} 已生成结果，但${detail}。${recoveryHint}`;
}

/**
 * 构造一条下载失败错误，并标注它是否值得重试。
 *
 * `retryable` 供上层的下载重试循环判断（见 media.js downloadResultMedia）：
 * 网络抖动 / 5xx / 传输中断 / 空文件这类**偶发**失败值得重试；而登录 HTML 回退、
 * 4xx、签名地址过期这类**确定性**失败重试只会原样再错一次，直接失败更快。
 * 消息文案刻意保持不变——浏览器路径（googleFlowImageWorkflow.js）不重试，仍按原样透出。
 */
function downloadError(providerName, detail, recoveryHint, { retryable }) {
    const error = new Error(resultRecoveryMessage(providerName, detail, recoveryHint));
    error.retryable = retryable;
    return error;
}

/** 值得重试的 HTTP 状态：5xx（服务端瞬时故障）、408 超时、429 限流。 */
function isRetryableHttpStatus(status) {
    return status >= 500 || status === 408 || status === 429;
}

/**
 * Download a result that has already consumed provider-side generation quota.
 *
 * A signed result URL can expire, redirect to an HTML login page, or hang. Those
 * cases must not be saved as a corrupt media file or phrased like a safe-to-retry
 * generation failure.
 */
export async function fetchWorkflowMedia(
    url,
    {
        providerName,
        expectedType,
        recoveryHint,
        timeoutMs = DEFAULT_WORKFLOW_MEDIA_TIMEOUT_MS,
        // Result CDNs behind a login (Flow's media.getMediaUrlRedirect needs the
        // Labs NextAuth cookie) accept the same request as the browser once the
        // caller supplies the headers. Never logged — see redactSecrets.
        headers,
        // 可选：调用方的取消信号。与每次尝试的超时合并，取消能立刻打断下载。
        signal,
        fetchImpl = fetch
    }
) {
    // 用户取消优先于「已生成结果」提示：不改写成可重试的下载失败。
    if (signal?.aborted) {
        const cancelled = new Error(`${providerName} 结果下载已取消`);
        cancelled.retryable = false;
        throw cancelled;
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal;
    let response;
    try {
        response = await fetchImpl(url, {
            headers: headers || undefined,
            redirect: 'follow',
            signal: attemptSignal
        });
    } catch (error) {
        // 调用方主动取消不算「下载失败」，更不该被重试。
        if (signal?.aborted) {
            const cancelled = new Error(`${providerName} 结果下载已取消`);
            cancelled.retryable = false;
            throw cancelled;
        }
        // 网络层异常（含超时）多为偶发，值得重试。
        throw downloadError(
            providerName,
            `自动下载失败：${error?.message || '网络请求失败'}`,
            recoveryHint,
            { retryable: true }
        );
    }

    if (!response.ok) {
        throw downloadError(
            providerName,
            `自动下载失败（HTTP ${response.status}）`,
            recoveryHint,
            { retryable: isRetryableHttpStatus(response.status) }
        );
    }

    const contentType = String(response.headers?.get?.('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const genericBinary = contentType === 'application/octet-stream';
    if (contentType && !contentType.startsWith(`${expectedType}/`) && !genericBinary) {
        // 返回了错误的内容类型（多为登录 HTML 回退 / 签名地址过期）：这是确定性失败，
        // 重试只会拿到同一个 HTML，直接失败让「去历史记录下载」提示尽快到用户眼前。
        throw downloadError(
            providerName,
            `下载地址返回了 ${contentType}，不是有效的${expectedType === 'image' ? '图片' : '视频'}`,
            recoveryHint,
            { retryable: false }
        );
    }

    let buffer;
    try {
        buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        // 传输中途断开是典型偶发故障，值得重试。
        throw downloadError(
            providerName,
            `下载连接在传输中断开：${error?.message || '读取结果失败'}`,
            recoveryHint,
            { retryable: true }
        );
    }
    if (buffer.length === 0) {
        // 空响应体多为 CDN 瞬时问题，值得重试。
        throw downloadError(
            providerName,
            '下载地址返回了空文件',
            recoveryHint,
            { retryable: true }
        );
    }
    return { buffer, contentType };
}
