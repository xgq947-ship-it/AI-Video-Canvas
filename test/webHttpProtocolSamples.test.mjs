import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    isFlowVideoCompleted,
    parseGenerateImagesResponse,
    parseGenerateVideoResponse
} from '../server/services/webhttp/flow/protocol.js';
import {
    extractConversation,
    extractGeneratedMedia,
    isGenerationPending
} from '../server/services/webhttp/gemini/protocol.js';
import {
    isJimengImageCompleted,
    isJimengVideoCompleted,
    parseJimengImageResults,
    parseJimengVideoResults,
    pickHistoryRecord,
    pollingConfigFrom
} from '../server/services/webhttp/jimeng/protocol.js';

const fixture = name => JSON.parse(fs.readFileSync(
    new URL(`./fixtures/webhttp/${name}`, import.meta.url),
    'utf8'
));

test('Flow 脱敏响应样本覆盖多图与异步视频状态', () => {
    const sample = fixture('flow-response-samples.json');
    assert.equal(sample.sanitized, true);

    const images = parseGenerateImagesResponse(sample.image);
    assert.equal(images.length, 2);
    assert.deepEqual(images.map(item => item.mediaId), ['flow-image-media-1', 'flow-image-media-2']);
    assert.equal(images[0].width, 1024);

    const videos = parseGenerateVideoResponse(sample.video);
    assert.equal(videos.length, 2);
    assert.equal(isFlowVideoCompleted(videos[0]), true);
    assert.equal(isFlowVideoCompleted(videos[1]), false);
    assert.equal(videos[0].resolution, 'VIDEO_RESOLUTION_720P');
});

test('Gemini 脱敏流样本按结构提取会话、图片和视频', () => {
    const sample = fixture('gemini-response-samples.json');
    const conversation = extractConversation(sample.completed);
    assert.equal(conversation.conversationId, 'c_81a9e9a61590b3fb');
    assert.equal(conversation.responseId, 'r_238139396e725795');

    const media = extractGeneratedMedia(sample.completed);
    assert.equal(media.images.length, 1);
    assert.equal(media.videos.length, 1);
    assert.match(media.images[0].mimeType, /^image\//);
    assert.equal(media.videos[0].sizeBytes, 2663169);
    assert.equal(isGenerationPending(sample.pending), true);
    assert.equal(isGenerationPending(sample.completed), false);
});

test('即梦脱敏历史样本按 submit_id 恢复多图和视频', () => {
    const sample = fixture('jimeng-response-samples.json');
    const imageRecord = pickHistoryRecord(sample.imageHistory, 'jimeng-submit-image-1');
    const videoRecord = pickHistoryRecord(sample.videoHistory, 'jimeng-submit-video-1');

    assert.equal(isJimengImageCompleted(imageRecord), true);
    assert.equal(parseJimengImageResults(imageRecord).length, 2);
    assert.equal(isJimengVideoCompleted(videoRecord), true);
    assert.equal(parseJimengVideoResults(videoRecord)[0].videoId, 'video-1');
    assert.deepEqual(pollingConfigFrom(sample.imageHistory), {
        intervalMs: 3000,
        timeoutMs: 600000
    });
});
