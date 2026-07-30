import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

import { FFPROBE_PATH } from '../../runtime/mediaTools.js';
import { resolveProjectMediaTarget } from '../../utils/projectAssets.js';
import { resolveAssetPath } from '../../utils/manifestAssets.js';
import { MediaResolverError, mediaResolver } from './mediaResolver.js';

export const MAX_REFERENCE_VIDEO_BYTES = 1024 * 1024 * 1024;

const SUPPORTED_EXTENSION_RE = /^\.(?:mp4|mov|webm)$/i;
const EXTENSION_BY_MIME = Object.freeze({
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'application/octet-stream': '.mp4',
  'binary/octet-stream': '.mp4',
});

export class ReferenceVideoError extends Error {
  constructor(message, { code = 'REFERENCE_VIDEO_FAILED', status = 400, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReferenceVideoError';
    this.code = code;
    this.status = status;
  }
}

function safeIdentifier(value, label) {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!safe || safe !== raw) {
    throw new ReferenceVideoError(`${label}无效`, {
      code: 'INVALID_REFERENCE_ID',
      status: 400,
    });
  }
  return safe;
}

function normalizeMimeType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function extensionForVideo({ filename, mimeType, url } = {}) {
  const normalizedMime = normalizeMimeType(mimeType);
  if (normalizedMime.startsWith('video/') && EXTENSION_BY_MIME[normalizedMime]) {
    return EXTENSION_BY_MIME[normalizedMime];
  }

  for (const candidate of [filename, url]) {
    if (!candidate) continue;
    let pathname = String(candidate);
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      pathname = pathname.split(/[?#]/)[0];
    }
    const extension = path.extname(pathname).toLowerCase();
    if (SUPPORTED_EXTENSION_RE.test(extension)) return extension;
  }

  if (EXTENSION_BY_MIME[normalizedMime]) return EXTENSION_BY_MIME[normalizedMime];

  throw new ReferenceVideoError('只支持 MP4、MOV 或 WebM 视频', {
    code: 'UNSUPPORTED_REFERENCE_VIDEO',
    status: 415,
  });
}

function parseRate(value) {
  const [numerator, denominator] = String(value || '').split('/').map(Number);
  if (!(numerator > 0)) return 0;
  return denominator > 0 ? numerator / denominator : numerator;
}

export function parseVideoProbe(payload) {
  const video = (payload?.streams || []).find(stream => stream?.codec_type === 'video');
  const audio = (payload?.streams || []).find(stream => stream?.codec_type === 'audio');
  const duration = Number(payload?.format?.duration);
  const width = Number(video?.width);
  const height = Number(video?.height);
  const fps = parseRate(video?.avg_frame_rate || video?.r_frame_rate);

  if (!(duration > 0) || !(width > 0) || !(height > 0)) {
    throw new ReferenceVideoError('无法读取视频尺寸或时长，请确认文件没有损坏', {
      code: 'REFERENCE_VIDEO_PROBE_FAILED',
      status: 422,
    });
  }

  return {
    duration,
    width,
    height,
    fps: fps > 0 ? Math.min(fps, 240) : 24,
    codec: video?.codec_name || undefined,
    audioCodec: audio?.codec_name || undefined,
    hasAudio: Boolean(audio),
    orientation: width === height ? 'square' : width > height ? 'landscape' : 'portrait',
  };
}

export function probeReferenceVideo(filePath, {
  ffprobePath = FFPROBE_PATH,
  spawnImpl = spawn,
  timeoutMs = 30_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate:format=duration',
      '-of', 'json',
      filePath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ReferenceVideoError('读取视频信息超时', {
        code: 'REFERENCE_VIDEO_PROBE_TIMEOUT',
        status: 422,
      })));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.once('error', error => finish(() => reject(new ReferenceVideoError(
      `Evan 内置 FFprobe 不可用：${error.message}`,
      { code: 'FFPROBE_UNAVAILABLE', status: 500, cause: error }
    ))));
    child.once('close', code => finish(() => {
      if (code !== 0) {
        reject(new ReferenceVideoError(
          `无法读取视频信息：${Buffer.concat(stderr).toString('utf8').slice(-400) || `FFprobe 退出码 ${code}`}`,
          { code: 'REFERENCE_VIDEO_PROBE_FAILED', status: 422 }
        ));
        return;
      }
      try {
        resolve(parseVideoProbe(JSON.parse(Buffer.concat(stdout).toString('utf8') || '{}')));
      } catch (error) {
        reject(error instanceof ReferenceVideoError ? error : new ReferenceVideoError(
          'FFprobe 返回了无法识别的数据',
          { code: 'REFERENCE_VIDEO_PROBE_FAILED', status: 422, cause: error }
        ));
      }
    }));
  });
}

function ipv4ToNumber(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(address, base, prefix) {
  const value = ipv4ToNumber(address);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function isPrivateNetworkAddress(address) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
    ].some(([base, prefix]) => inIpv4Range(address, base, prefix));
  }
  if (ipVersion === 6) {
    const normalized = String(address).toLowerCase().split('%')[0];
    if (normalized.startsWith('::ffff:')) {
      return isPrivateNetworkAddress(normalized.slice('::ffff:'.length));
    }
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('ff')
      || normalized.startsWith('2001:db8:');
  }
  return true;
}

export async function assertPublicMediaUrl(value, { lookupImpl = dns.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new ReferenceVideoError('解析服务返回了无效的视频地址', {
      code: 'INVALID_DOWNLOAD_URL',
      status: 502,
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ReferenceVideoError('解析服务返回了不安全的视频地址', {
      code: 'UNSAFE_DOWNLOAD_URL',
      status: 502,
    });
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostname.toLowerCase() === 'localhost') {
    throw new ReferenceVideoError('拒绝下载本机或内网地址', {
      code: 'UNSAFE_DOWNLOAD_URL',
      status: 502,
    });
  }

  const directIp = net.isIP(hostname) ? [{ address: hostname }] : null;
  let addresses;
  try {
    addresses = directIp || await lookupImpl(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new ReferenceVideoError(`无法解析视频下载域名：${hostname}`, {
      code: 'DOWNLOAD_DNS_FAILED',
      status: 502,
      cause: error,
    });
  }
  // Clash and similar local proxy/TUN tools commonly return 198.18.0.0/15 as
  // synthetic DNS addresses for otherwise-public hostnames. A literal URL to
  // that range remains blocked; only a validated hostname may use the proxy's
  // synthetic mapping.
  const proxySyntheticAddress = address => !directIp
    && net.isIP(address) === 4
    && inIpv4Range(address, '198.18.0.0', 15);
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some(entry => (
      isPrivateNetworkAddress(entry?.address)
      && !proxySyntheticAddress(entry?.address)
    ))) {
    throw new ReferenceVideoError('拒绝下载本机或内网地址', {
      code: 'UNSAFE_DOWNLOAD_URL',
      status: 502,
    });
  }
  return parsed;
}

function referenceTarget(workflowId, remixId, context) {
  const safeRemixId = safeIdentifier(remixId, 'remixId');
  let projectMedia;
  try {
    projectMedia = resolveProjectMediaTarget(workflowId, 'videos', {
      workflowsDir: context.workflowsDir,
      projectsDir: context.projectsDir,
    });
  } catch (error) {
    throw new ReferenceVideoError(error?.message || '当前项目不可用', {
      code: error?.code || 'PROJECT_REQUIRED',
      status: error?.code === 'PROJECT_NOT_FOUND' ? 404 : 400,
      cause: error,
    });
  }
  const referenceId = `ref_${crypto.randomUUID()}`;
  const projectRoot = path.dirname(projectMedia.targetDir);
  const directory = path.join(projectRoot, 'video-remix', safeRemixId, 'source', referenceId);
  fs.mkdirSync(directory, { recursive: true });
  const encodedSegments = ['video-remix', safeRemixId, 'source', referenceId]
    .map(segment => encodeURIComponent(segment))
    .join('/');
  return {
    directory,
    referenceId,
    publicPrefix: `/library/projects/${encodeURIComponent(projectMedia.projectDirName)}/${encodedSegments}`,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function atomicWriteJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2));
  await fsp.rename(temporary, filePath);
}

async function finalizeReference({
  target,
  originalPath,
  extension,
  sourceType,
  sourceUrl,
  platform,
  title,
  originalFilename,
  probeImpl,
}) {
  const probe = await probeImpl(originalPath);
  const sourceHash = await sha256File(originalPath);
  const localUrl = `${target.publicPrefix}/original${extension}`;
  const source = {
    id: target.referenceId,
    sourceType,
    ...(platform ? { platform } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    localUrl,
    ...(originalFilename ? { originalFilename } : {}),
    ...(title ? { title } : {}),
    ...probe,
    previewUrl: localUrl,
    sourceHash,
  };
  const {
    localUrl: _projectScopedLocalUrl,
    previewUrl: _projectScopedPreviewUrl,
    ...portableMetadata
  } = source;
  await atomicWriteJson(path.join(target.directory, 'metadata.json'), {
    ...portableMetadata,
    originalFile: `original${extension}`,
    createdAt: new Date().toISOString(),
  });
  return source;
}

async function cleanFailedTarget(target) {
  if (!target?.directory) return;
  try {
    await fsp.rm(target.directory, { recursive: true, force: true });
  } catch {
    // A failed import must not hide its original error because cleanup failed.
  }
}

export async function saveReferenceVideoBuffer({
  workflowId,
  remixId,
  buffer,
  mimeType,
  originalFilename,
  sourceType = 'local',
  sourceUrl,
  platform,
  title,
}, context) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ReferenceVideoError('视频文件为空', {
      code: 'EMPTY_REFERENCE_VIDEO',
      status: 400,
    });
  }
  if (buffer.length > (context.maxBytes || MAX_REFERENCE_VIDEO_BYTES)) {
    throw new ReferenceVideoError('参考视频不能超过 1GB', {
      code: 'REFERENCE_VIDEO_TOO_LARGE',
      status: 413,
    });
  }
  const extension = extensionForVideo({ filename: originalFilename, mimeType });
  const target = referenceTarget(workflowId, remixId, context);
  const originalPath = path.join(target.directory, `original${extension}`);
  try {
    await fsp.writeFile(originalPath, buffer, { flag: 'wx' });
    return await finalizeReference({
      target,
      originalPath,
      extension,
      sourceType,
      sourceUrl,
      platform,
      title,
      originalFilename,
      probeImpl: context.probeImpl || probeReferenceVideo,
    });
  } catch (error) {
    await cleanFailedTarget(target);
    throw error;
  }
}

function byteLimitTransform(maxBytes) {
  let total = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new ReferenceVideoError('参考视频不能超过 1GB', {
          code: 'REFERENCE_VIDEO_TOO_LARGE',
          status: 413,
        }));
        return;
      }
      callback(null, chunk);
    },
  });
}

export async function saveReferenceVideoStream(readable, {
  workflowId,
  remixId,
  mimeType,
  originalFilename,
  contentLength,
}, context) {
  const maxBytes = context.maxBytes || MAX_REFERENCE_VIDEO_BYTES;
  if (Number(contentLength) > maxBytes) {
    throw new ReferenceVideoError('参考视频不能超过 1GB', {
      code: 'REFERENCE_VIDEO_TOO_LARGE',
      status: 413,
    });
  }
  const extension = extensionForVideo({ filename: originalFilename, mimeType });
  const target = referenceTarget(workflowId, remixId, context);
  const temporaryPath = path.join(target.directory, '.upload.tmp');
  const originalPath = path.join(target.directory, `original${extension}`);
  try {
    await pipeline(
      readable,
      byteLimitTransform(maxBytes),
      fs.createWriteStream(temporaryPath, { flags: 'wx' })
    );
    const stat = await fsp.stat(temporaryPath);
    if (stat.size === 0) {
      throw new ReferenceVideoError('视频文件为空', {
        code: 'EMPTY_REFERENCE_VIDEO',
        status: 400,
      });
    }
    await fsp.rename(temporaryPath, originalPath);
    return await finalizeReference({
      target,
      originalPath,
      extension,
      sourceType: 'local',
      originalFilename,
      title: originalFilename ? path.basename(originalFilename, path.extname(originalFilename)) : undefined,
      probeImpl: context.probeImpl || probeReferenceVideo,
    });
  } catch (error) {
    await cleanFailedTarget(target);
    throw error;
  }
}

function nodeReadable(responseBody) {
  if (!responseBody) {
    throw new ReferenceVideoError('视频下载地址返回了空响应', {
      code: 'EMPTY_REFERENCE_VIDEO',
      status: 502,
    });
  }
  return typeof responseBody.getReader === 'function'
    ? Readable.fromWeb(responseBody)
    : responseBody;
}

async function fetchPublicVideo(url, {
  fetchImpl,
  lookupImpl,
  signal,
  referer,
  range = 'bytes=0-',
  maxRedirects = 5,
}) {
  let current = String(url);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    await assertPublicMediaUrl(current, { lookupImpl });
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.5',
        // Bilibili/Flow-style streaming CDNs wait for an explicit byte range.
        range,
        // Several media CDNs reject generic/non-browser user agents even for a
        // public signed URL. This matches a normal stable Chrome navigation;
        // it does not carry a user profile, cookies or automation session.
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        ...(referer ? { referer } : {}),
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location');
      if (!location) {
        throw new ReferenceVideoError('视频下载重定向缺少目标地址', {
          code: 'DOWNLOAD_FAILED',
          status: 502,
        });
      }
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      throw new ReferenceVideoError(`视频下载失败（HTTP ${response.status}）`, {
        code: 'DOWNLOAD_FAILED',
        status: 502,
      });
    }
    return { response, finalUrl: current };
  }
  throw new ReferenceVideoError('视频下载重定向次数过多', {
    code: 'DOWNLOAD_FAILED',
    status: 502,
  });
}

function validateDownloadedVideoResponse(response) {
  const contentType = normalizeMimeType(response.headers?.get?.('content-type'));
  const genericBinary = ['application/octet-stream', 'binary/octet-stream'].includes(contentType);
  if (contentType && !contentType.startsWith('video/') && !genericBinary) {
    throw new ReferenceVideoError(`下载地址返回了 ${contentType}，不是有效视频`, {
      code: 'DOWNLOAD_NOT_VIDEO',
      status: 502,
    });
  }
  return contentType;
}

function parseContentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

export async function downloadReferenceVideo({
  workflowId,
  remixId,
  mediaUrl,
  sourceUrl,
  platform,
  title,
}, context) {
  const target = referenceTarget(workflowId, remixId, context);
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error('视频下载超时')),
    context.downloadTimeoutMs || 180_000
  );
  timeout.unref?.();
  const temporaryPath = path.join(target.directory, '.download.tmp');

  try {
    const maxBytes = context.maxBytes || MAX_REFERENCE_VIDEO_BYTES;
    const chunkBytes = Math.max(256 * 1024, Math.min(
      Number(context.downloadChunkBytes) || 4 * 1024 * 1024,
      16 * 1024 * 1024
    ));
    const requestOptions = {
      fetchImpl: context.fetchImpl || fetch,
      lookupImpl: context.lookupImpl || dns.lookup,
      signal: timeoutController.signal,
      referer: sourceUrl,
    };
    let requestUrl = mediaUrl;
    let nextOffset = 0;
    let totalBytes = null;
    let writtenBytes = 0;
    let finalUrl = mediaUrl;
    let contentType = '';

    do {
      if (nextOffset >= maxBytes) {
        throw new ReferenceVideoError('参考视频不能超过 1GB', {
          code: 'REFERENCE_VIDEO_TOO_LARGE',
          status: 413,
        });
      }
      const requestedEnd = Math.min(nextOffset + chunkBytes - 1, maxBytes - 1);
      const fetched = await fetchPublicVideo(requestUrl, {
        ...requestOptions,
        range: `bytes=${nextOffset}-${requestedEnd}`,
      });
      const { response } = fetched;
      finalUrl = fetched.finalUrl;
      requestUrl = finalUrl;
      const responseType = validateDownloadedVideoResponse(response);
      if (!contentType) contentType = responseType;

      const contentRange = parseContentRange(response.headers?.get?.('content-range'));
      if (response.status === 206) {
        if (!contentRange || contentRange.start !== nextOffset || contentRange.end < contentRange.start) {
          throw new ReferenceVideoError('视频 CDN 返回了无效的分段范围', {
            code: 'DOWNLOAD_PROTOCOL_ERROR',
            status: 502,
          });
        }
        if (contentRange.total !== null) {
          totalBytes = contentRange.total;
          if (totalBytes > maxBytes) {
            throw new ReferenceVideoError('参考视频不能超过 1GB', {
              code: 'REFERENCE_VIDEO_TOO_LARGE',
              status: 413,
            });
          }
        }
      } else if (nextOffset > 0) {
        throw new ReferenceVideoError('视频 CDN 未按要求继续分段下载', {
          code: 'DOWNLOAD_PROTOCOL_ERROR',
          status: 502,
        });
      } else {
        const contentLength = Number(response.headers?.get?.('content-length'));
        if (contentLength > maxBytes) {
          throw new ReferenceVideoError('参考视频不能超过 1GB', {
            code: 'REFERENCE_VIDEO_TOO_LARGE',
            status: 413,
          });
        }
      }

      const before = writtenBytes;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          writtenBytes += chunk.length;
          if (writtenBytes > maxBytes) {
            callback(new ReferenceVideoError('参考视频不能超过 1GB', {
              code: 'REFERENCE_VIDEO_TOO_LARGE',
              status: 413,
            }));
            return;
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        nodeReadable(response.body),
        limiter,
        fs.createWriteStream(temporaryPath, { flags: nextOffset === 0 ? 'wx' : 'a' })
      );
      const received = writtenBytes - before;
      if (received === 0) {
        throw new ReferenceVideoError('视频下载地址返回了空文件', {
          code: 'EMPTY_REFERENCE_VIDEO',
          status: 502,
        });
      }

      if (response.status !== 206) {
        totalBytes = writtenBytes;
        break;
      }
      const expected = contentRange.end - contentRange.start + 1;
      if (received !== expected) {
        throw new ReferenceVideoError('视频下载连接在分段传输中断开', {
          code: 'DOWNLOAD_INTERRUPTED',
          status: 502,
        });
      }
      nextOffset = contentRange.end + 1;
      if (totalBytes === null && received < chunkBytes) totalBytes = nextOffset;
    } while (totalBytes === null || nextOffset < totalBytes);

    const stat = await fsp.stat(temporaryPath);
    if (stat.size === 0 || stat.size !== writtenBytes) {
      throw new ReferenceVideoError('视频下载地址返回了空文件', {
        code: 'EMPTY_REFERENCE_VIDEO',
        status: 502,
      });
    }
    const extension = extensionForVideo({ mimeType: contentType, url: finalUrl });
    const originalPath = path.join(target.directory, `original${extension}`);
    await fsp.rename(temporaryPath, originalPath);
    return await finalizeReference({
      target,
      originalPath,
      extension,
      sourceType: 'url',
      sourceUrl,
      platform,
      title,
      originalFilename: title ? `${title}${extension}` : undefined,
      probeImpl: context.probeImpl || probeReferenceVideo,
    });
  } catch (error) {
    await cleanFailedTarget(target);
    if (error?.name === 'AbortError' || timeoutController.signal.aborted) {
      throw new ReferenceVideoError('视频下载超时，请重试', {
        code: 'DOWNLOAD_TIMEOUT',
        status: 504,
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveReferenceVideoFromUrl({
  workflowId,
  remixId,
  input,
}, context) {
  let resolved;
  try {
    resolved = await (context.resolver || mediaResolver).resolve(input);
  } catch (error) {
    if (error instanceof MediaResolverError) throw error;
    throw new ReferenceVideoError(error?.message || '媒体解析失败', {
      code: 'MEDIA_RESOLVER_FAILED',
      status: 502,
      cause: error,
    });
  }

  const candidates = [
    resolved.videoUrl,
    resolved.metadata?.alternateVideoUrl,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  let lastError;
  for (const mediaUrl of candidates) {
    try {
      return await downloadReferenceVideo({
        workflowId,
        remixId,
        mediaUrl,
        sourceUrl: resolved.sourceUrl,
        platform: resolved.platform,
        title: resolved.title,
      }, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new ReferenceVideoError('解析结果没有可下载的视频地址', {
    code: 'DOWNLOAD_FAILED',
    status: 502,
  });
}

export async function copyCanvasVideoAsReference({
  workflowId,
  remixId,
  sourceUrl,
  title,
}, context) {
  if (!sourceUrl) {
    throw new ReferenceVideoError('画布视频还没有可用结果', {
      code: 'CANVAS_VIDEO_NOT_READY',
      status: 409,
    });
  }
  let sourcePath;
  try {
    let decodedSourceUrl = sourceUrl;
    try {
      decodedSourceUrl = decodeURIComponent(sourceUrl);
    } catch {
      // Keep the original value; resolveAssetPath will still enforce bounds.
    }
    sourcePath = resolveAssetPath(context.libraryDir, decodedSourceUrl);
  } catch (error) {
    throw new ReferenceVideoError('只能把已保存到 Evan 项目中的视频用作参考视频', {
      code: 'CANVAS_VIDEO_NOT_LOCAL',
      status: 400,
      cause: error,
    });
  }
  let stat;
  try {
    stat = await fsp.stat(sourcePath);
  } catch {
    throw new ReferenceVideoError('画布视频文件不存在，请重新生成或导入', {
      code: 'CANVAS_VIDEO_NOT_FOUND',
      status: 404,
    });
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new ReferenceVideoError('画布视频文件不可用', {
      code: 'CANVAS_VIDEO_NOT_FOUND',
      status: 404,
    });
  }
  if (stat.size > (context.maxBytes || MAX_REFERENCE_VIDEO_BYTES)) {
    throw new ReferenceVideoError('参考视频不能超过 1GB', {
      code: 'REFERENCE_VIDEO_TOO_LARGE',
      status: 413,
    });
  }

  const extension = extensionForVideo({ filename: sourcePath, url: sourceUrl });
  const target = referenceTarget(workflowId, remixId, context);
  const originalPath = path.join(target.directory, `original${extension}`);
  try {
    await fsp.copyFile(sourcePath, originalPath, fs.constants.COPYFILE_EXCL);
    return await finalizeReference({
      target,
      originalPath,
      extension,
      sourceType: 'canvas',
      sourceUrl,
      platform: 'canvas',
      title,
      originalFilename: path.basename(sourcePath),
      probeImpl: context.probeImpl || probeReferenceVideo,
    });
  } catch (error) {
    await cleanFailedTarget(target);
    throw error;
  }
}
