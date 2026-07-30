import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertPublicMediaUrl,
  copyCanvasVideoAsReference,
  downloadReferenceVideo,
  isPrivateNetworkAddress,
  parseVideoProbe,
  saveReferenceVideoBuffer,
} from '../server/services/videoRemix/referenceVideo.js';

const PROBE = Object.freeze({
  duration: 18.42,
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'h264',
  audioCodec: 'aac',
  hasAudio: true,
  orientation: 'portrait',
});

function makeContext(t) {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-remix-reference-'));
  t.after(() => fs.rmSync(libraryDir, { recursive: true, force: true }));
  const workflowsDir = path.join(libraryDir, 'workflows');
  const projectsDir = path.join(libraryDir, 'projects');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1',
    title: '测试项目',
    projectDirName: '测试项目',
    nodes: [],
  }));
  return {
    libraryDir,
    workflowsDir,
    projectsDir,
    probeImpl: async () => ({ ...PROBE }),
  };
}

test('FFprobe 响应被归一化为 ReferenceVideo 元数据', () => {
  assert.deepEqual(parseVideoProbe({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
    format: { duration: '5.5' },
  }), {
    duration: 5.5,
    width: 1920,
    height: 1080,
    fps: 30000 / 1001,
    codec: 'h264',
    audioCodec: 'aac',
    hasAudio: true,
    orientation: 'landscape',
  });
});

test('本地视频原字节保存到项目 video-remix 目录并写出元数据', async (t) => {
  const context = makeContext(t);
  const bytes = Buffer.from('synthetic-video-bytes');
  const source = await saveReferenceVideoBuffer({
    workflowId: 'workflow-1',
    remixId: 'remix_1',
    buffer: bytes,
    mimeType: 'video/mp4',
    originalFilename: '参考 视频.mp4',
  }, context);

  assert.equal(source.sourceType, 'local');
  assert.equal(source.duration, PROBE.duration);
  assert.match(source.localUrl, /^\/library\/projects\/.+\/video-remix\/remix_1\/source\/ref_.+\/original\.mp4$/);
  const relative = decodeURIComponent(source.localUrl.replace('/library/', ''));
  const originalPath = path.join(context.libraryDir, relative);
  assert.deepEqual(fs.readFileSync(originalPath), bytes);
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(originalPath), 'metadata.json'), 'utf8'));
  assert.equal(metadata.sourceHash, source.sourceHash);
  assert.equal(metadata.originalFile, 'original.mp4');
});

test('自定义项目位置中的原视频写到外部项目根目录', async (t) => {
  const context = makeContext(t);
  const externalRoot = path.join(context.libraryDir, 'external-project');
  fs.writeFileSync(path.join(context.workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1',
    title: '外部项目',
    projectDirName: '外部项目',
    projectPath: externalRoot,
    nodes: [],
  }));

  const source = await saveReferenceVideoBuffer({
    workflowId: 'workflow-1',
    remixId: 'remix_external',
    buffer: Buffer.from('external-video'),
    mimeType: 'application/octet-stream',
    originalFilename: 'external.webm',
  }, context);

  const originalPath = path.join(
    externalRoot,
    'video-remix',
    'remix_external',
    'source',
    source.id,
    'original.webm'
  );
  assert.deepEqual(fs.readFileSync(originalPath), Buffer.from('external-video'));
});

test('画布视频会复制而不是移动或修改源文件', async (t) => {
  const context = makeContext(t);
  const sourceDir = path.join(context.projectsDir, '测试项目', 'videos');
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, 'canvas.mp4');
  const bytes = Buffer.from('canvas-video');
  fs.writeFileSync(sourcePath, bytes);

  const reference = await copyCanvasVideoAsReference({
    workflowId: 'workflow-1',
    remixId: 'remix_canvas',
    sourceUrl: '/library/projects/%E6%B5%8B%E8%AF%95%E9%A1%B9%E7%9B%AE/videos/canvas.mp4',
    title: '画布镜头',
  }, context);

  assert.equal(reference.sourceType, 'canvas');
  assert.deepEqual(fs.readFileSync(sourcePath), bytes);
  const copiedPath = path.join(context.libraryDir, decodeURIComponent(reference.localUrl.replace('/library/', '')));
  assert.deepEqual(fs.readFileSync(copiedPath), bytes);
  assert.notEqual(copiedPath, sourcePath);
});

test('下载器拒绝 localhost、私网地址', async () => {
  assert.equal(isPrivateNetworkAddress('127.0.0.1'), true);
  assert.equal(isPrivateNetworkAddress('10.1.2.3'), true);
  assert.equal(isPrivateNetworkAddress('93.184.216.34'), false);
  assert.equal(isPrivateNetworkAddress('::1'), true);

  await assert.rejects(
    assertPublicMediaUrl('http://localhost/video.mp4'),
    error => error.code === 'UNSAFE_DOWNLOAD_URL'
  );
  await assert.rejects(
    assertPublicMediaUrl('https://private.example/video.mp4', {
      lookupImpl: async () => [{ address: '192.168.1.2', family: 4 }],
    }),
    error => error.code === 'UNSAFE_DOWNLOAD_URL'
  );
  await assert.doesNotReject(
    assertPublicMediaUrl('https://public-cdn.example/video.mp4', {
      lookupImpl: async () => [{ address: '198.18.0.7', family: 4 }],
    })
  );
  await assert.rejects(
    assertPublicMediaUrl('https://198.18.0.7/video.mp4'),
    error => error.code === 'UNSAFE_DOWNLOAD_URL'
  );
});

test('远程视频按流写盘并逐跳校验下载 URL', async (t) => {
  const context = makeContext(t);
  const requested = [];
  const result = await downloadReferenceVideo({
    workflowId: 'workflow-1',
    remixId: 'remix_url',
    mediaUrl: 'https://media.example/start',
    sourceUrl: 'https://www.bilibili.com/video/example',
    platform: 'bilibili',
    title: '公开视频',
  }, {
    ...context,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      if (url.endsWith('/start')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/video.mp4' },
        });
      }
      return new Response(Buffer.from('downloaded-video'), {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(Buffer.byteLength('downloaded-video')),
        },
      });
    },
  });

  assert.deepEqual(requested.map(item => item.url), [
    'https://media.example/start',
    'https://cdn.example/video.mp4',
  ]);
  assert.equal(requested[1].options.redirect, 'manual');
  assert.equal(requested[1].options.headers.referer, 'https://www.bilibili.com/video/example');
  assert.equal(result.sourceType, 'url');
  assert.equal(result.platform, 'bilibili');
  const savedPath = path.join(context.libraryDir, decodeURIComponent(result.localUrl.replace('/library/', '')));
  assert.deepEqual(fs.readFileSync(savedPath), Buffer.from('downloaded-video'));
});

test('会用有界 Range 分段完整下载容易中断的媒体 CDN', async (t) => {
  const context = makeContext(t);
  const payload = Buffer.alloc(300 * 1024, 7);
  const ranges = [];
  const result = await downloadReferenceVideo({
    workflowId: 'workflow-1',
    remixId: 'remix_chunked',
    mediaUrl: 'https://cdn.example/large.mp4',
    sourceUrl: 'https://source.example/video/1',
    platform: 'test',
    title: '分段测试',
  }, {
    ...context,
    downloadChunkBytes: 256 * 1024,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (_url, options) => {
      ranges.push(options.headers.range);
      const match = options.headers.range.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(match[1]);
      const requestedEnd = Number(match[2]);
      const end = Math.min(requestedEnd, payload.length - 1);
      return new Response(payload.subarray(start, end + 1), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': `bytes ${start}-${end}/${payload.length}`,
          'content-length': String(end - start + 1),
        },
      });
    },
  });

  assert.deepEqual(ranges, ['bytes=0-262143', 'bytes=262144-524287']);
  const savedPath = path.join(context.libraryDir, decodeURIComponent(result.localUrl.replace('/library/', '')));
  assert.deepEqual(fs.readFileSync(savedPath), payload);
});
