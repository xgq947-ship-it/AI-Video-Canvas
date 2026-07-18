import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSeedanceRequest, mapSeedanceModelName, SEEDANCE_BASE_URL } from '../server/services/seedance.js';
import { buildKlingVideoRequest, mapKlingVideoModelName } from '../server/services/kling.js';

test('Seedance 前端模型 ID 映射到官方模型名', () => {
    assert.equal(mapSeedanceModelName('seedance-2-0'), 'doubao-seedance-2-0-260128');
    assert.equal(mapSeedanceModelName('seedance-2-0-fast'), 'doubao-seedance-2-0-fast-260128');
    assert.equal(mapSeedanceModelName('seedance-1-5-pro'), 'doubao-seedance-1-5-pro-251215');
});

test('Seedance 使用火山方舟中国区接口', () => {
    assert.equal(SEEDANCE_BASE_URL, 'https://ark.cn-beijing.volces.com/api/v3');
});

test('Seedance 请求真实携带音频与首尾帧参数', () => {
    const request = buildSeedanceRequest({
        prompt: '人物转身并说话',
        imageBase64: 'data:image/png;base64,AAA',
        lastFrameBase64: 'data:image/png;base64,BBB',
        modelId: 'seedance-2-0',
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 10,
        generateAudio: false
    });

    assert.equal(request.generate_audio, false);
    assert.equal(request.ratio, '9:16');
    assert.equal(request.resolution, '1080p');
    assert.equal(request.duration, 10);
    assert.equal(request.content[1].role, 'first_frame');
    assert.equal(request.content[2].role, 'last_frame');
});

test('Seedance 非法画面参数使用安全默认值', () => {
    const request = buildSeedanceRequest({
        prompt: '',
        aspectRatio: 'Auto',
        resolution: 'Auto',
        duration: 99,
        generateAudio: true
    });

    assert.equal(request.generate_audio, true);
    assert.equal(request.ratio, 'adaptive');
    assert.equal(request.resolution, '720p');
    assert.equal(request.duration, 15);
});

test('Seedance 按中国区模型能力限制分辨率与时长', () => {
    const fast = buildSeedanceRequest({
        modelId: 'seedance-2-0-fast',
        resolution: '1080p',
        duration: 2
    });
    const legacy = buildSeedanceRequest({
        modelId: 'seedance-1-5-pro',
        resolution: '2k',
        duration: 15
    });

    assert.equal(fast.resolution, '720p');
    assert.equal(fast.duration, 4);
    assert.equal(legacy.resolution, '720p');
    assert.equal(legacy.duration, 12);
});

test('Seedance 请求携带人物参考音频', () => {
    const request = buildSeedanceRequest({
        prompt: '人物说出本次台词',
        imageBase64: 'data:image/png;base64,AAA',
        referenceAudioUrls: ['data:audio/mpeg;base64,VOICE'],
        modelId: 'seedance-2-0'
    });

    const audio = request.content.find(item => item.type === 'audio_url');
    assert.deepEqual(audio, {
        type: 'audio_url',
        audio_url: { url: 'data:audio/mpeg;base64,VOICE' },
        role: 'reference_audio'
    });
});

test('Seedance 参考音频需要首帧且不能与尾帧共用', () => {
    assert.throws(() => buildSeedanceRequest({
        prompt: '人物说话',
        referenceAudioUrls: ['data:audio/mpeg;base64,VOICE']
    }), /至少一张首帧图片/);

    assert.throws(() => buildSeedanceRequest({
        prompt: '人物说话',
        imageBase64: 'data:image/png;base64,AAA',
        lastFrameBase64: 'data:image/png;base64,BBB',
        referenceAudioUrls: ['data:audio/mpeg;base64,VOICE']
    }), /不能与尾帧模式同时使用/);
});

test('Seedance 1.5 Pro 不接受输入参考音频', () => {
    assert.throws(() => buildSeedanceRequest({
        prompt: '人物说话',
        imageBase64: 'data:image/png;base64,AAA',
        referenceAudioUrls: ['data:audio/mpeg;base64,VOICE'],
        modelId: 'seedance-1-5-pro'
    }), /仅支持 Seedance 2.0/);
});

test('Kling 3 前端模型 ID 映射到官方模型名', () => {
    assert.equal(mapKlingVideoModelName('kling-v3'), 'kling-v3');
    assert.equal(mapKlingVideoModelName('kling-v3-turbo'), 'kling-v3-0-turbo');
});

test('Kling 3 请求真实携带原生音频开关', () => {
    const withAudio = buildKlingVideoRequest({
        prompt: '人物说话',
        modelId: 'kling-v3',
        aspectRatio: '1:1',
        resolution: '1080p',
        duration: 8,
        generateAudio: true
    });
    const withoutAudio = buildKlingVideoRequest({
        prompt: '静音镜头',
        imageBase64: 'data:image/png;base64,AAA',
        modelId: 'kling-v3-turbo',
        generateAudio: false
    });

    assert.equal(withAudio.endpoint, 'text2video');
    assert.equal(withAudio.body.sound, 'on');
    assert.equal(withAudio.body.mode, 'pro');
    assert.equal(withAudio.body.aspect_ratio, '1:1');
    assert.equal(withoutAudio.endpoint, 'image2video');
    assert.equal(withoutAudio.body.sound, 'off');
});
