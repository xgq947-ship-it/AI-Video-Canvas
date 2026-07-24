const DEFAULT_WORKFLOW_MEDIA_TIMEOUT_MS = 30_000;

function resultRecoveryMessage(providerName, detail, recoveryHint) {
    return `${providerName} 已生成结果，但${detail}。${recoveryHint}`;
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
        fetchImpl = fetch
    }
) {
    let response;
    try {
        response = await fetchImpl(url, {
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (error) {
        throw new Error(resultRecoveryMessage(
            providerName,
            `自动下载失败：${error?.message || '网络请求失败'}`,
            recoveryHint
        ));
    }

    if (!response.ok) {
        throw new Error(resultRecoveryMessage(
            providerName,
            `自动下载失败（HTTP ${response.status}）`,
            recoveryHint
        ));
    }

    const contentType = String(response.headers?.get?.('content-type') || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    const genericBinary = contentType === 'application/octet-stream';
    if (contentType && !contentType.startsWith(`${expectedType}/`) && !genericBinary) {
        throw new Error(resultRecoveryMessage(
            providerName,
            `下载地址返回了 ${contentType}，不是有效的${expectedType === 'image' ? '图片' : '视频'}`,
            recoveryHint
        ));
    }

    let buffer;
    try {
        buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
        throw new Error(resultRecoveryMessage(
            providerName,
            `下载连接在传输中断开：${error?.message || '读取结果失败'}`,
            recoveryHint
        ));
    }
    if (buffer.length === 0) {
        throw new Error(resultRecoveryMessage(
            providerName,
            '下载地址返回了空文件',
            recoveryHint
        ));
    }
    return { buffer, contentType };
}
