const DEFAULT_RESOLVER_ORIGIN = 'https://dyxhsdownloader.com';
const DEFAULT_TIMEOUT_MS = 30_000;
const DIRECT_VIDEO_EXTENSION_RE = /\.(?:mp4|mov|webm)(?:$|[?#])/i;
const TRAILING_SHARE_PUNCTUATION_RE = /[)\]}>，。！？；：、）》】」』"'`.,!?;:]+$/u;

export class MediaResolverError extends Error {
  constructor(message, { code = 'MEDIA_RESOLVER_FAILED', status = 502, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MediaResolverError';
    this.code = code;
    this.status = status;
  }
}

export function extractMediaUrl(input) {
  const text = String(input || '').trim();
  const match = text.match(/https?:\/\/[^\s<]+/iu);
  if (!match) {
    throw new MediaResolverError('没有在分享文案中找到 http(s) 链接', {
      code: 'INVALID_MEDIA_URL',
      status: 400,
    });
  }

  const candidate = match[0].replace(TRAILING_SHARE_PUNCTUATION_RE, '');
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new MediaResolverError('分享链接格式无效', {
      code: 'INVALID_MEDIA_URL',
      status: 400,
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new MediaResolverError('只支持 http(s) 分享链接', {
      code: 'INVALID_MEDIA_URL',
      status: 400,
    });
  }
  if (parsed.username || parsed.password) {
    throw new MediaResolverError('分享链接不能包含账号或密码', {
      code: 'INVALID_MEDIA_URL',
      status: 400,
    });
  }
  return parsed.toString();
}

function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('请求超时')), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function readJsonResponse(response, endpointName) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new MediaResolverError(`${endpointName}返回了无法识别的数据`, {
      code: 'MEDIA_RESOLVER_PROTOCOL_CHANGED',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new MediaResolverError(
      String(payload?.error || `${endpointName}请求失败（HTTP ${response.status}）`),
      { code: 'MEDIA_RESOLVER_HTTP_ERROR' }
    );
  }
  if (payload?.error) {
    throw new MediaResolverError(String(payload.error), {
      code: 'MEDIA_RESOLVER_REJECTED',
    });
  }
  return payload;
}

async function postJson(fetchImpl, url, body, timeoutMs) {
  const timeout = createTimeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    return await readJsonResponse(response, new URL(url).pathname);
  } catch (error) {
    if (error instanceof MediaResolverError) throw error;
    const timedOut = timeout.signal.aborted;
    throw new MediaResolverError(
      timedOut ? '媒体解析服务请求超时，请稍后重试' : `媒体解析服务不可用：${error?.message || '网络请求失败'}`,
      {
        code: timedOut ? 'MEDIA_RESOLVER_TIMEOUT' : 'MEDIA_RESOLVER_UNAVAILABLE',
        cause: error,
      }
    );
  } finally {
    timeout.clear();
  }
}

/**
 * dyxhsdownloader.com public resolver adapter.
 *
 * The protocol was verified against the public page on 2026-07-30. It is kept
 * behind a provider boundary because this third-party contract can change.
 */
export class DyXhsDownloaderProvider {
  constructor({
    fetchImpl = fetch,
    origin = DEFAULT_RESOLVER_ORIGIN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.id = 'dyxhs-downloader';
    this.fetchImpl = fetchImpl;
    this.origin = String(origin).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  canHandle(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  async resolve(url, { userInput = url } = {}) {
    const sourceUrl = extractMediaUrl(url);

    // A real media URL does not need a platform parser. Keeping this fast path
    // inside the same provider preserves the one-provider MVP while supporting
    // the requirement's "ordinary video URL" input.
    if (DIRECT_VIDEO_EXTENSION_RE.test(sourceUrl)) {
      let title = new URL(sourceUrl).pathname.split('/').pop() || 'video';
      try {
        title = decodeURIComponent(title);
      } catch {
        // Keep the encoded filename when the remote path has malformed escapes.
      }
      return {
        sourceUrl,
        platform: 'direct',
        type: 'video',
        title,
        videoUrl: sourceUrl,
        metadata: { resolver: this.id, direct: true },
      };
    }

    const resolved = await postJson(
      this.fetchImpl,
      `${this.origin}/api/resolve`,
      { url: sourceUrl },
      this.timeoutMs
    );
    const finalUrl = extractMediaUrl(resolved?.finalUrl || sourceUrl);
    const parsed = await postJson(
      this.fetchImpl,
      `${this.origin}/api/parse`,
      {
        url: finalUrl,
        originalUrl: sourceUrl,
        userInput: String(userInput || sourceUrl).trim(),
      },
      this.timeoutMs
    );

    if (parsed?.success === false) {
      throw new MediaResolverError(String(parsed?.error || '媒体解析失败'), {
        code: 'MEDIA_RESOLVER_REJECTED',
      });
    }

    const data = parsed?.data;
    if (!data || typeof data !== 'object') {
      throw new MediaResolverError('媒体解析响应缺少 data', {
        code: 'MEDIA_RESOLVER_PROTOCOL_CHANGED',
      });
    }
    if (data.type !== 'video') {
      throw new MediaResolverError('当前链接解析为图集，Video Remix 第一版只支持视频', {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        status: 415,
      });
    }
    const videoUrl = typeof data.videoUrl === 'string' && data.videoUrl
      ? data.videoUrl
      : typeof data.videoUrlAlt === 'string' ? data.videoUrlAlt : '';
    if (!videoUrl) {
      throw new MediaResolverError('媒体解析响应缺少可下载的视频地址', {
        code: 'MEDIA_RESOLVER_PROTOCOL_CHANGED',
      });
    }

    return {
      sourceUrl,
      platform: String(parsed.provider || 'unknown'),
      type: 'video',
      title: typeof data.title === 'string' ? data.title : undefined,
      coverUrl: typeof data.cover === 'string' ? data.cover : undefined,
      videoUrl,
      metadata: {
        resolver: this.id,
        author: typeof data.author === 'string' ? data.author : undefined,
        description: typeof data.description === 'string' ? data.description : undefined,
        watermarkStatus: typeof data.watermarkStatus === 'string' ? data.watermarkStatus : undefined,
        alternateVideoUrl: typeof data.videoUrlAlt === 'string' ? data.videoUrlAlt : undefined,
      },
    };
  }
}

export function createMediaResolver({ providers = [new DyXhsDownloaderProvider()] } = {}) {
  const registered = [...providers];
  return {
    providers: registered,
    async resolve(input) {
      const sourceUrl = extractMediaUrl(input);
      const provider = registered.find(candidate => candidate?.canHandle?.(sourceUrl));
      if (!provider) {
        throw new MediaResolverError('没有可处理此链接的媒体解析器', {
          code: 'MEDIA_RESOLVER_NOT_FOUND',
          status: 400,
        });
      }
      return provider.resolve(sourceUrl, { userInput: input });
    },
  };
}

export const mediaResolver = createMediaResolver();
