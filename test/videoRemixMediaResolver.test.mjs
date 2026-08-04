import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DyXhsDownloaderProvider,
  MediaResolverError,
  createMediaResolver,
  extractMediaUrl,
} from '../server/services/videoRemix/mediaResolver.js';

test('分享文案会提取第一个 URL 并移除中文尾部标点', () => {
  assert.equal(
    extractMediaUrl('6.82 复制打开抖音，看看 https://v.douyin.com/abc123/。 更多内容'),
    'https://v.douyin.com/abc123/'
  );
  assert.equal(
    extractMediaUrl('watch https://media.example/video.mp4,'),
    'https://media.example/video.mp4'
  );
  assert.throws(
    () => extractMediaUrl('这里没有链接'),
    error => error instanceof MediaResolverError && error.code === 'INVALID_MEDIA_URL'
  );
});

test('DyXhsDownloaderProvider 严格复用已验证的 resolve + parse 协议', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('/api/resolve')) {
      return new Response(JSON.stringify({
        originalUrl: 'https://v.douyin.com/abc/',
        finalUrl: 'https://www.douyin.com/video/123',
        status: 200,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      success: true,
      provider: 'douyin',
      data: {
        type: 'video',
        title: '测试视频',
        cover: 'https://cdn.example/cover.jpg',
        videoUrl: 'https://cdn.example/video.mp4?token=secret',
        videoUrlAlt: 'https://backup.example/video.mp4',
        author: '作者',
        description: '描述',
        watermarkStatus: 'removed',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const resolver = createMediaResolver({
    providers: [new DyXhsDownloaderProvider({ fetchImpl, origin: 'https://resolver.example' })],
  });

  const result = await resolver.resolve('复制这段文案 https://www.bilibili.com/video/BV1gW411w7ES/ 打开 App');

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, { url: 'https://www.bilibili.com/video/BV1gW411w7ES/' });
  assert.deepEqual(calls[1].body, {
    url: 'https://www.douyin.com/video/123',
    originalUrl: 'https://www.bilibili.com/video/BV1gW411w7ES/',
    userInput: '复制这段文案 https://www.bilibili.com/video/BV1gW411w7ES/ 打开 App',
  });
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.equal(result.platform, 'douyin');
  assert.equal(result.type, 'video');
  assert.equal(result.videoUrl, 'https://cdn.example/video.mp4?token=secret');
  assert.equal(result.metadata.alternateVideoUrl, 'https://backup.example/video.mp4');
});

test('普通视频直链不调用第三方 parse 接口', async () => {
  let calls = 0;
  const provider = new DyXhsDownloaderProvider({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('不应调用');
    },
  });

  const result = await provider.resolve('https://media.example/path/demo.webm?download=1');

  assert.equal(calls, 0);
  assert.equal(result.platform, 'direct');
  assert.equal(result.videoUrl, 'https://media.example/path/demo.webm?download=1');
});

test('抖音分享链接使用备用解析，不依赖被 Cloudflare 拦截的旧解析站', async () => {
  const calls = [];
  const provider = new DyXhsDownloaderProvider({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        code: 200,
        msg: '解析成功',
        data: {
          title: '抖音测试视频',
          url: 'https://cdn.example/video-hd.mp4',
          cover: 'https://cdn.example/cover.jpg',
          author: { nickname: '作者' },
          images: '当前为短视频解析模式',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await provider.resolve('复制打开抖音 https://v.douyin.com/abc123/');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.xhus\.cn\/api\/douyin\?url=/);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(result.platform, 'douyin');
  assert.equal(result.title, '抖音测试视频');
  assert.equal(result.videoUrl, 'https://cdn.example/video-hd.mp4');
  assert.equal(result.metadata.resolver, 'xhus');
});

test('图集结果会以可识别错误拒绝', async () => {
  const provider = new DyXhsDownloaderProvider({
    fetchImpl: async (url) => new Response(JSON.stringify(
      url.endsWith('/api/resolve')
        ? { finalUrl: 'https://www.xiaohongshu.com/explore/1' }
        : { success: true, provider: 'xiaohongshu', data: { type: 'images', images: ['x'] } }
    ), { status: 200, headers: { 'content-type': 'application/json' } }),
  });

  await assert.rejects(
    provider.resolve('https://xhslink.com/a'),
    error => error instanceof MediaResolverError && error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
});
