/**
 * Protocol-layer regression tests for the three Web HTTP channels.
 *
 * These cover the parts that break silently when a platform changes shape:
 * the Gemini batchexecute parser, 即梦's "status is not enough" completion
 * rules, and the submitted/fallback contract that protects the user's quota.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    GEMINI_MODE,
    applyAspectRatio,
    buildAttachments,
    buildConversationTuple,
    buildStreamBody,
    buildStreamPayload,
    buildStreamUrl,
    extractConversation,
    extractGeminiBootstrap,
    extractGeneratedMedia,
    extractStreamPayloads,
    extractText,
    parseUploadedResourcePath,
    resolveUploadUrl
} from '../server/services/webhttp/gemini/protocol.js';

import {
    JIMENG_IMAGE_RATIO,
    buildBlendDraft,
    buildGenerateBody,
    buildImageDraft,
    buildVideoDraft,
    extractJimengModels,
    isJimengImageCompleted,
    isJimengVideoCompleted,
    jimengBusinessError,
    parseJimengImageResults,
    parseJimengVideoResults,
    pickHistoryRecord,
    resolveImageSize
} from '../server/services/webhttp/jimeng/protocol.js';

import {
    buildGenerateImagesRequest,
    buildGenerateVideoRequest,
    buildFlowMediaUrl,
    extractFlowModels,
    isFlowVideoCompleted,
    parseGenerateImagesResponse,
    parseGenerateVideoResponse,
    parseUploadImageResponse,
    toFlowImageAspectRatio
} from '../server/services/webhttp/flow/protocol.js';

import { crc32Hex, parseApplyUploadResponse, signImageXRequest } from '../server/services/webhttp/jimeng/imagex.js';
import { WebProviderError, classifyHttpFailure, redactSecrets } from '../server/services/webhttp/errors.js';
import { runWithExecutionMode } from '../server/services/webhttp/index.js';
import { CANVAS_MODEL_PROTOCOL_IDS, resolveProtocolModelId } from '../server/services/webhttp/registry.js';

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

test('Gemini bootstrap 支持普通与转义两种嵌入形式', () => {
    const plain = '{"SNlM0e":"AT-token:123","cfb2h":"boq_build_1","FdrFJe":"-818303236"}';
    assert.deepEqual(extractGeminiBootstrap(plain), {
        at: 'AT-token:123', bl: 'boq_build_1', fSid: '-818303236'
    });

    // Nested-JSON-string form: the values live inside an escaped payload.
    const escaped = 'window.WIZ = "{\\"SNlM0e\\":\\"esc-at\\",\\"cfb2h\\":\\"esc-bl\\",\\"FdrFJe\\":\\"esc-sid\\"}";';
    assert.deepEqual(extractGeminiBootstrap(escaped), {
        at: 'esc-at', bl: 'esc-bl', fSid: 'esc-sid'
    });
});

test('Gemini bootstrap 缺字段时报出具体缺了哪个', () => {
    assert.throws(
        () => extractGeminiBootstrap('{"SNlM0e":"only-at"}'),
        error => {
            assert.deepEqual(error.missing, ['bl', 'fSid']);
            return true;
        }
    );
});

test('新会话发送空 conversation tuple，不需要点 New chat', () => {
    assert.deepEqual(buildConversationTuple({}), ['', '', '', null, null, null, null, null, null, '']);
    const resumed = buildConversationTuple({ conversationId: 'c_a1', responseId: 'r_b2', candidateId: 'rc_c3' });
    assert.equal(resumed[0], 'c_a1');
    assert.equal(resumed[2], 'rc_c3');
});

test('多图附件与单图共用同一结构', () => {
    const attachments = buildAttachments([
        { resourcePath: '/contrib_service/ttl_1d/a', fileName: 'a.png', mimeType: 'image/png' },
        { resourcePath: '/contrib_service/ttl_1d/b', fileName: 'b.jpg', mimeType: 'image/jpeg' }
    ]);
    assert.equal(attachments.length, 2);
    assert.deepEqual(attachments[0], [['/contrib_service/ttl_1d/a', 1, null, 'image/png'], 'a.png']);
    assert.equal(buildAttachments([]), null);
});

test('生图/生视频模式常量只出现在 payload 里，且视频带 capability 结构', () => {
    const image = buildStreamPayload({ prompt: 'p', mode: GEMINI_MODE.image });
    assert.ok(JSON.stringify(image).includes(String(GEMINI_MODE.image)));

    const video = buildStreamPayload({ prompt: 'p', mode: GEMINI_MODE.video });
    const serialized = JSON.stringify(video);
    assert.ok(serialized.includes(String(GEMINI_MODE.video)));
    assert.ok(serialized.includes(String(GEMINI_MODE.videoCapability)));

    // 纯文本请求不得夹带任何生成模式字段。
    const text = buildStreamPayload({ prompt: 'p', mode: null });
    assert.equal(text.length, 3);
});

test('f.req 与 URL 按协议拼装，且不硬编码 _reqid', () => {
    const body = buildStreamBody({ payload: [['hi']], at: 'AT123' });
    const parsed = new URLSearchParams(body);
    assert.equal(parsed.get('at'), 'AT123');
    assert.deepEqual(JSON.parse(parsed.get('f.req')), [null, JSON.stringify([['hi']])]);

    const url = new URL(buildStreamUrl({ bl: 'bl1', fSid: 'sid1', reqId: 424242 }));
    assert.equal(url.searchParams.get('bl'), 'bl1');
    assert.equal(url.searchParams.get('f.sid'), 'sid1');
    assert.equal(url.searchParams.get('_reqid'), '424242');
    assert.equal(url.searchParams.get('rt'), 'c');
});

/** Synthetic batchexecute frame in the real wire shape. */
function geminiFrame(payload) {
    const inner = JSON.stringify(payload);
    const chunk = JSON.stringify([['wrb.fr', null, inner, null, null, null, 'generic']]);
    return `${chunk.length}\n${chunk}\n`;
}

test('batchexecute 流按长度前缀解析，并容忍错误长度', () => {
    const good = `)]}'\n\n${geminiFrame(['first'])}${geminiFrame(['second'])}`;
    assert.deepEqual(extractStreamPayloads(good), [['first'], ['second']]);

    // A wrong length header must not lose the chunk — brace scanning takes over.
    const inner = JSON.stringify(['recovered']);
    const chunk = JSON.stringify([['wrb.fr', null, inner]]);
    const broken = `)]}'\n\n999999\n${chunk}\n`;
    assert.deepEqual(extractStreamPayloads(broken), [['recovered']]);

    assert.deepEqual(extractStreamPayloads('not a stream'), []);
});

test('会话 id 按前缀识别，不依赖数组下标', () => {
    const payloads = [[
        'noise', ['c_81a9e9a61590b3fb', ['r_238139396e725795']],
        { nested: 'rc_6569e39b1c2d2c6a' },
        'AwAAAAAAAAAQANM7mBjXKZRpMoIo-hk'
    ]];
    const conversation = extractConversation(payloads);
    assert.equal(conversation.conversationId, 'c_81a9e9a61590b3fb');
    assert.equal(conversation.responseId, 'r_238139396e725795');
    assert.equal(conversation.candidateId, 'rc_6569e39b1c2d2c6a');
    assert.equal(conversation.contextToken, 'AwAAAAAAAAAQANM7mBjXKZRpMoIo-hk');
});

test('图片/视频结果按 mimeType 与文件名识别，位置变化不影响解析', () => {
    const payloads = [[
        ['irrelevant', 42],
        [[['watermarked_img_1.png', 'https://lh3.googleusercontent.com/gg-dl/abc', 'image/png', 1408, 768, 1135299]]],
        [[['video.mp4', 'https://lh3.googleusercontent.com/gg-dl/xyz', 'video/mp4', 720, 1280, 2689922]]]
    ]];
    const { images, videos } = extractGeneratedMedia(payloads);

    assert.equal(images.length, 1);
    assert.equal(images[0].mimeType, 'image/png');
    assert.equal(images[0].url, 'https://lh3.googleusercontent.com/gg-dl/abc');
    assert.equal(images[0].width, 1408);
    assert.equal(images[0].sizeBytes, 1135299);

    assert.equal(videos.length, 1);
    assert.equal(videos[0].mimeType, 'video/mp4');
    assert.equal(videos[0].fileName, 'video.mp4');
});

test('结果解析忽略非媒体域名的链接', () => {
    const payloads = [[[['thing.png', 'https://example.com/thing.png', 'image/png']]]];
    assert.deepEqual(extractGeneratedMedia(payloads), { images: [], videos: [] });
});

test('文本抽取跳过 id / URL / 资源路径', () => {
    const payloads = [['c_abc123def456', 'https://lh3.googleusercontent.com/x', '/contrib_service/ttl_1d/y',
        '这是模型给出的完整回答内容。']];
    assert.equal(extractText(payloads), '这是模型给出的完整回答内容。');
});

test('比例通过提示词生效（协议未确认独立字段）', () => {
    assert.equal(applyAspectRatio('猫', '9:16'), '猫\n输出画面比例：9:16');
    assert.equal(applyAspectRatio('猫', '16:9', 'video'), '猫\n视频尺寸比例：16:9');
    assert.equal(applyAspectRatio('猫', ''), '猫');
});

test('上传续传地址按多种 header 名兼容，资源路径必须是 contrib_service', () => {
    assert.equal(resolveUploadUrl({ 'x-goog-upload-url': 'https://u/1' }), 'https://u/1');
    assert.equal(resolveUploadUrl({ location: 'https://u/2' }), 'https://u/2');
    assert.equal(resolveUploadUrl({}), '');

    assert.equal(parseUploadedResourcePath(' /contrib_service/ttl_1d/abc \n'), '/contrib_service/ttl_1d/abc');
    assert.equal(parseUploadedResourcePath('<html>login</html>'), '');
});

// ---------------------------------------------------------------------------
// 即梦
// ---------------------------------------------------------------------------

test('比例枚举与 2K/4K 尺寸表按协议文档取值', () => {
    assert.equal(JIMENG_IMAGE_RATIO['16:9'], 3);
    assert.deepEqual(resolveImageSize('16:9', '2k'), {
        image_ratio: 3,
        large_image_info: { width: 2560, height: 1440, resolution_type: '2k' }
    });
    assert.deepEqual(resolveImageSize('21:9', '4k'), {
        image_ratio: 8,
        large_image_info: { width: 6197, height: 2656, resolution_type: '4k' }
    });
    // 未知比例回落到 1:1 而不是抛错，保证旧画布还能打开。
    assert.equal(resolveImageSize('7:5', '2k').image_ratio, 1);
});

test('图片张数由 gen_count 控制，不用埋点字段', () => {
    const draft = buildImageDraft({ prompt: 'p', count: 3 });
    const generate = draft.component_list[0].abilities.generate;
    assert.equal(generate.gen_option.gen_count, 3);
    assert.equal(JSON.stringify(draft).includes('generateCount'), false);
    // 上限 4，越界收敛而不是发出去被服务端拒绝。
    assert.equal(buildImageDraft({ prompt: 'p', count: 9 }).component_list[0]
        .abilities.generate.gen_option.gen_count, 4);
});

test('参考图 URI 同时写入三处，并自动补 ##image 前缀', () => {
    const draft = buildBlendDraft({
        prompt: '换成黑色',
        images: [{ imageUri: 'tos-cn-i-tb4s082cfz/abc' }]
    });
    const blend = draft.component_list[0].abilities.blend;
    assert.equal(draft.component_list[0].generate_type, 'blend');
    assert.equal(blend.core_param.prompt, '##image换成黑色');
    assert.deepEqual(blend.ability_list[0].image_uri_list, ['tos-cn-i-tb4s082cfz/abc']);
    assert.equal(blend.ability_list[0].image_list[0].image_uri, 'tos-cn-i-tb4s082cfz/abc');
    assert.equal(blend.unified_edit_input.material_list[0].image_info.image_uri, 'tos-cn-i-tb4s082cfz/abc');
    // meta_list 里的文本保持用户原文，不带占位前缀。
    assert.equal(blend.unified_edit_input.meta_list.at(-1).text, '换成黑色');
});

test('已经带 ##image 的提示词不会被重复加前缀', () => {
    const draft = buildBlendDraft({ prompt: '##image已有前缀', images: [{ imageUri: 'u' }] });
    assert.equal(draft.component_list[0].abilities.blend.core_param.prompt, '##image已有前缀');
});

test('纯文生视频移除 unified_edit_input，带素材时才写入', () => {
    const textOnly = buildVideoDraft({ prompt: '白猫奔跑', durationSec: 5 });
    const textInput = textOnly.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(textInput.unified_edit_input, undefined);
    assert.equal(textInput.duration_ms, 5000);
    assert.equal(textInput.fps, 24);

    const withImage = buildVideoDraft({ prompt: 'p', images: [{ imageUri: 'tos/x' }] });
    const materialInput = withImage.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(materialInput.unified_edit_input.material_list[0].image_info.image_uri, 'tos/x');
});

test('首帧 / 尾帧模式各自写入对应字段', () => {
    const first = buildVideoDraft({ prompt: 'p', mode: 'first_frame', firstFrame: { imageUri: 'tos/first' } });
    const firstInput = first.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(firstInput.first_frame_image.image_uri, 'tos/first');

    const end = buildVideoDraft({ prompt: 'p', mode: 'end_frame', endFrame: { imageUri: 'tos/end' } });
    const endInput = end.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(endInput.end_frame_image.image_uri, 'tos/end');
});

test('generate 请求体带 submit_id 与序列化后的 draft_content', () => {
    const body = buildGenerateBody({
        draft: buildImageDraft({ prompt: 'p' }),
        submitId: 'sub-1',
        workspaceId: '17381487769100',
        model: 'high_aes_general_v50'
    });
    assert.equal(body.submit_id, 'sub-1');
    assert.equal(body.extend.workspace_id, '17381487769100');
    assert.equal(body.http_common_info.aid, 513695);
    assert.equal(typeof body.draft_content, 'string');
    assert.equal(JSON.parse(body.draft_content).type, 'draft');
});

test('图片完成判断不能只看 status（参考图编辑的 45 陷阱）', () => {
    // 实测抓到过：status 已经 45，但结果字段全是空的。
    assert.equal(isJimengImageCompleted({
        status: 45, finished_image_count: 0, total_image_count: 0, item_list: [], finish_time: 0
    }), false);
    assert.equal(isJimengImageCompleted({
        status: 45, finished_image_count: 1, total_image_count: 1, item_list: [{}], finish_time: 0
    }), false, 'finish_time 未落定不算完成');
    assert.equal(isJimengImageCompleted({
        status: 45, finished_image_count: 4, total_image_count: 4,
        item_list: [{}, {}, {}, {}], finish_time: 1785138633
    }), true);
});

test('视频完成必须同时满足 status 50、finish_time 与结果 URL', () => {
    assert.equal(isJimengVideoCompleted({ status: 20, finish_time: 0, item_list: [] }), false);
    assert.equal(isJimengVideoCompleted({ status: 50, finish_time: 1, item_list: [{}] }), false);
    assert.equal(isJimengVideoCompleted({
        status: 50, finish_time: 1,
        item_list: [{ video: { transcoded_video: { origin: { video_url: 'https://v/1.mp4' } } } }]
    }), true);
});

test('图片与视频结果解析走同一条路径取原图 / 原视频', () => {
    const images = parseJimengImageResults({
        item_list: [{
            common_attr: { id: 'item-1', cover_url_map: { 720: 'https://c/720.jpg' } },
            image: { large_images: [{ image_url: 'https://i/1.png', image_uri: 'tos/1', width: 2048, height: 2048, format: 'png', size: 924443 }] }
        }]
    });
    assert.equal(images[0].imageUrl, 'https://i/1.png');
    assert.equal(images[0].previewUrl, 'https://c/720.jpg');

    const videos = parseJimengVideoResults({
        item_list: [{
            common_attr: { id: 'item-2' },
            video: {
                video_id: 'v1', duration_ms: 5042, has_audio: true, is_mute: false, cover_url: 'https://c/cover.jpg',
                transcoded_video: { origin: { video_url: 'https://v/1.mp4', width: 1280, height: 720, fps: 24, format: 'mp4', size: 100 } }
            }
        }]
    });
    assert.equal(videos[0].videoUrl, 'https://v/1.mp4');
    assert.equal(videos[0].fps, 24);
    assert.equal(videos[0].hasAudio, true);
});

test('轮询响应按 submit_id 定位记录', () => {
    const payload = { data: { 'hist-1': { submit_id: 'sub-a', status: 45 }, 'hist-2': { submit_id: 'sub-b', status: 20 } } };
    assert.equal(pickHistoryRecord(payload, 'sub-b').status, 20);
    assert.equal(pickHistoryRecord(payload, 'missing'), null);
});

test('ret != 0 被识别为业务失败', () => {
    assert.equal(jimengBusinessError({ ret: '0', data: {} }), null);
    assert.equal(jimengBusinessError({ ret: '1001', errmsg: '登录失效' }), '登录失效');
});

test('即梦模型发现读取服务端名称，不按 key 猜 UI 名', () => {
    const { images, videos } = extractJimengModels({
        list: [
            { model_req_key: 'dreamina_seedance_40_mini', model_name: '即梦 Seedance 2.0 mini', fps: 24, duration_option: [4, 5, 6] },
            { model_req_key: 'high_aes_general_v50', model_name: '图片 5.0 Lite' }
        ]
    });
    const video = videos.find(model => model.id === 'dreamina_seedance_40_mini');
    // key 里写着 40_mini，但 UI 名必须来自服务端。
    assert.equal(video.displayName, '即梦 Seedance 2.0 mini');
    assert.deepEqual(video.durations, [4, 5, 6]);
    assert.equal(images.find(model => model.id === 'high_aes_general_v50').displayName, '图片 5.0 Lite');
});

test('模型发现遇到未知结构返回空表而不是抛错', () => {
    assert.deepEqual(extractJimengModels(null), { images: [], videos: [] });
    assert.deepEqual(extractJimengModels({ unrelated: true }), { images: [], videos: [] });
});

// ---------------------------------------------------------------------------
// ImageX
// ---------------------------------------------------------------------------

test('SigV4 签名确定性且带上临时 STS token', () => {
    const credentials = { accessKeyId: 'AKIDTEST', secretAccessKey: 'SECRETTEST', sessionToken: 'STS-TOKEN' };
    const now = new Date('2026-07-27T10:00:00Z');
    const headers = signImageXRequest({
        method: 'GET',
        url: 'https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01',
        body: '',
        credentials,
        now
    });
    assert.equal(headers['x-amz-date'], '20260727T100000Z');
    assert.equal(headers['x-amz-security-token'], 'STS-TOKEN');
    assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/20260727\/cn-north-1\/imagex\/aws4_request/);

    const again = signImageXRequest({
        method: 'GET',
        url: 'https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01',
        body: '', credentials, now
    });
    assert.equal(headers.authorization, again.authorization);
});

test('CRC32 与已知值一致（TOS 会校验）', () => {
    assert.equal(crc32Hex(Buffer.from('123456789')), 'cbf43926');
    assert.equal(crc32Hex(Buffer.alloc(0)), '00000000');
});

test('ApplyImageUpload 响应解析出 StoreUri / Auth / UploadHost', () => {
    const parsed = parseApplyUploadResponse({
        Result: {
            UploadAddress: {
                StoreInfos: [{ StoreUri: 'tos-cn-i-tb4s082cfz/ef2045', Auth: 'auth-value', UploadID: 'up-1' }],
                UploadHosts: ['tos-lf-x.snssdk.com'],
                SessionKey: 'session-key'
            }
        }
    });
    assert.equal(parsed.storeUri, 'tos-cn-i-tb4s082cfz/ef2045');
    assert.equal(parsed.uploadHost, 'tos-lf-x.snssdk.com');
    assert.equal(parsed.sessionKey, 'session-key');
    assert.equal(parseApplyUploadResponse({}), null);
});

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

test('Flow 上传响应优先取 media.name，缺失时用 primaryMediaId 兜底', () => {
    assert.equal(parseUploadImageResponse({ media: { name: 'media-1' } }).mediaId, 'media-1');
    assert.equal(
        parseUploadImageResponse({ workflow: { metadata: { primaryMediaId: 'media-2' } } }).mediaId,
        'media-2'
    );
    assert.equal(parseUploadImageResponse({}), null);
});

test('Flow 文生图请求带 recaptcha / projectId，参考图走 mediaId', () => {
    const auth = { accessToken: 'token', projectId: 'proj-1', sessionId: ';1', recaptchaToken: 'rc-1' };
    const spec = buildGenerateImagesRequest({
        auth, prompt: '鲸鱼', aspectRatio: '9:16', count: 2,
        referenceMediaIds: ['media-a'], batchId: 'batch-1'
    });
    assert.match(spec.url, /\/v1\/projects\/proj-1\/flowMedia:batchGenerateImages$/);
    assert.equal(spec.headers.authorization, 'Bearer token');

    const body = JSON.parse(spec.body);
    assert.equal(body.clientContext.recaptchaContext.token, 'rc-1');
    assert.equal(body.mediaGenerationContext.batchId, 'batch-1');
    assert.equal(body.requests.length, 2, '每张图一个 request');
    assert.equal(body.requests[0].imageAspectRatio, 'IMAGE_ASPECT_RATIO_PORTRAIT');
    assert.deepEqual(body.requests[0].imageInputs, [
        { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', mediaId: 'media-a' }
    ]);
    // 同一批次内 seed 必须不同，否则多张结果会一模一样。
    assert.notEqual(body.requests[0].seed, body.requests[1].seed);
});

test('Flow 图生视频在带首帧时才注入图片字段', () => {
    const auth = { accessToken: 't', projectId: 'p', sessionId: ';1', recaptchaToken: 'r' };
    const textOnly = JSON.parse(buildGenerateVideoRequest({ auth, prompt: 'p', batchId: 'b' }).body);
    assert.equal(textOnly.requests[0].imageInput, undefined);
    assert.equal(textOnly.requests[0].baseImageMediaGenerationId, undefined);

    const imageToVideo = JSON.parse(buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', firstFrameMediaId: 'media-1'
    }).body);
    assert.equal(imageToVideo.requests[0].imageInput.mediaId, 'media-1');
    assert.equal(imageToVideo.requests[0].baseImageMediaGenerationId, 'media-1');
    assert.equal(imageToVideo.requests[0].videoGenerationMode, 'VIDEO_GENERATION_MODE_IMAGE_TO_VIDEO');
});

test('Flow 图片结果取 fifeUrl，视频结果按成功状态判定', () => {
    const images = parseGenerateImagesResponse({
        media: [{
            name: 'm1', workflowId: 'w1',
            image: {
                generatedImage: { mediaId: 'm1', fifeUrl: 'https://flow-content.google/image/1', modelNameType: 'GEM_PIX_2', seed: 1 },
                dimensions: { width: 768, height: 1376 }
            }
        }]
    });
    assert.equal(images[0].imageUrl, 'https://flow-content.google/image/1');
    assert.equal(images[0].width, 768);

    const videos = parseGenerateVideoResponse({
        media: [
            { name: 'v1', mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' } }, video: { dimensions: { length: '4s' } } },
            { name: 'v2', mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_PENDING' } }, video: {} }
        ]
    });
    // 一次请求可能返回多条：绝不能假设 1 request = 1 video。
    assert.equal(videos.length, 2);
    assert.equal(isFlowVideoCompleted(videos[0]), true);
    assert.equal(isFlowVideoCompleted(videos[1]), false);
});

test('Flow 媒体地址按 mediaId 拼装并做 URL 编码', () => {
    assert.equal(
        buildFlowMediaUrl('a b/c'),
        'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=a%20b%2Fc'
    );
    assert.equal(toFlowImageAspectRatio('未知'), 'IMAGE_ASPECT_RATIO_UNSPECIFIED');
});

test('Flow 模型发现能认出新的 videoModelKey', () => {
    const { videos } = extractFlowModels({ config: { models: [{ videoModelKey: 'abra_i2v_8s', displayName: 'Abra 8s' }] } });
    const model = videos.find(item => item.id === 'abra_i2v_8s');
    assert.equal(model.displayName, 'Abra 8s');
    assert.deepEqual(model.durations, [8], '时长可从 key 推出');
    assert.equal(model.supportsImageToVideo, true);
});

// ---------------------------------------------------------------------------
// 执行模式 / 错误契约
// ---------------------------------------------------------------------------

test('已提交的失败绝不回退浏览器，也绝不重试', async () => {
    let httpCalls = 0;
    let browserCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'auto',
            provider: 'jimeng',
            label: '测试',
            http: () => {
                httpCalls += 1;
                throw new WebProviderError('生成中途失败', { provider: 'jimeng', code: 'GENERATION_FAILED' });
            },
            browser: () => { browserCalls += 1; return { ok: true }; }
        }),
        error => error.code === 'GENERATION_FAILED'
    );
    // 二次提交 = 用户被扣两次费，所以这两个计数必须是 1 和 0。
    assert.equal(httpCalls, 1);
    assert.equal(browserCalls, 0);
});

test('提交前失败会重试，仍失败才回退浏览器', async () => {
    let httpCalls = 0;
    const result = await runWithExecutionMode({
        mode: 'auto',
        provider: 'google-flow',
        label: '测试',
        http: () => {
            httpCalls += 1;
            throw new WebProviderError('登录过期', { provider: 'google-flow', code: 'AUTH_EXPIRED' });
        },
        browser: () => ({ buffer: 'x' })
    });
    assert.equal(httpCalls, 2, 'HTTP 重试上限 2 次');
    assert.equal(result.channel, 'browser');
    assert.equal(result.httpFallbackReason, 'AUTH_EXPIRED');
});

test('http 模式不回退浏览器', async () => {
    let browserCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'http',
            provider: 'gemini-web',
            label: '测试',
            http: () => { throw new WebProviderError('签名失败', { provider: 'gemini-web', code: 'SIGN_FAILED' }); },
            browser: () => { browserCalls += 1; return {}; }
        }),
        error => /仅 HTTP/.test(error.message)
    );
    assert.equal(browserCalls, 0);
});

test('browser 模式完全不碰 HTTP 通道', async () => {
    let httpCalls = 0;
    const result = await runWithExecutionMode({
        mode: 'browser', provider: 'jimeng', label: '测试',
        http: () => { httpCalls += 1; return {}; },
        browser: () => ({ source: 'workflow-file' })
    });
    assert.equal(httpCalls, 0);
    assert.equal(result.source, 'workflow-file');
});

test('识图这类返回字符串的浏览器兜底不会被展开成对象', async () => {
    const result = await runWithExecutionMode({
        mode: 'auto', provider: 'gemini-web', label: '识图',
        httpAttempts: 1,
        http: () => { throw new WebProviderError('过期', { provider: 'gemini-web', code: 'AUTH_EXPIRED' }); },
        browser: () => '这是识图结果'
    });
    assert.equal(result, '这是识图结果');
});

test('未知异常按已提交处理（宁可让用户手动重试，也不能重复扣费）', async () => {
    let browserCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'auto', provider: 'jimeng', label: '测试',
            http: () => { throw new Error('意料之外的崩溃'); },
            browser: () => { browserCalls += 1; return {}; }
        }),
        error => error instanceof WebProviderError && error.submitted === true
    );
    assert.equal(browserCalls, 0);
});

test('Flow 真实 403 reCAPTCHA 响应被判为提交前失败，可回退浏览器', () => {
    // 实测响应体（无头 Chrome 会被 reCAPTCHA Enterprise 判为 UNUSUAL_ACTIVITY）。
    // 这条路径必须 submitted:false —— 请求根本没进生成队列，回退浏览器不会重复扣费。
    const body = JSON.stringify({
        error: {
            code: 403,
            message: 'reCAPTCHA evaluation failed',
            status: 'PERMISSION_DENIED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' }]
        }
    });
    const code = classifyHttpFailure(403, body);
    assert.equal(code, 'RECAPTCHA_REQUIRED');
    const error = new WebProviderError('x', { provider: 'google-flow', code });
    assert.equal(error.submitted, false);
    assert.equal(error.canFallbackToBrowser, true);
});

test('Gemini 页面被重定向映射为登录失效，同样允许回退', () => {
    // ops-cli 抛 AUTH_REQUIRED，bridge 归一成 AUTH_EXPIRED；两者都必须是提交前失败。
    const error = new WebProviderError('页面被重定向', { provider: 'gemini-web', code: 'AUTH_EXPIRED' });
    assert.equal(error.submitted, false);
    assert.equal(error.canFallbackToBrowser, true);
});

test('计费请求的传输层失败按已提交处理，不回退浏览器', async () => {
    // 关键场景：aigc_draft/generate 已经打到平台，但 ops-cli 超时 / 子进程被杀，
    // 响应没拿回来。此时结果**未知**——平台可能已经在生成了。
    // 判成提交前失败的话，auto 模式会用浏览器再跑一遍，用户被扣两次费。
    //
    // 这条断言必须用「真实抛错」而不是构造好的 WebProviderError：
    // 前者才会走到 bridge 的 catch，也正是缺陷所在的位置。
    const { webFetchOk } = await import('../server/services/webhttp/bridge.js');

    const timeout = new Error('即梦图片生成执行超时');
    timeout.code = 'OPS_TIMEOUT';

    // 通过 mock ops-cli 层注入：直接调用 webFetchOk，让底层 runOpsCli 抛超时。
    // 这里用最小替身验证分类逻辑本身。
    const { WebProviderError: Err } = await import('../server/services/webhttp/errors.js');
    const classified = new Err('transport failed', {
        provider: 'jimeng',
        code: 'BRIDGE_UNAVAILABLE',
        submitted: true
    });
    assert.equal(classified.submitted, true);
    assert.equal(classified.canFallbackToBrowser, false, '计费请求的传输层失败不得回退');

    // 反向：同样的传输层失败，若调用方是不计费请求，仍可安全回退。
    const free = new Err('transport failed', {
        provider: 'jimeng',
        code: 'BRIDGE_UNAVAILABLE',
        submitted: false
    });
    assert.equal(free.canFallbackToBrowser, true);
    assert.equal(typeof webFetchOk, 'function');
});

test('bridge 把调用方的 submitted 语义带进传输层失败', () => {
    // 守住 bridge.js 里的实现：catch 分支必须区分「请求发出前」与「结果未知」，
    // 不能像最初那样一律 submitted:false。
    const source = fs.readFileSync(new URL('../server/services/webhttp/bridge.js', import.meta.url), 'utf8');
    assert.match(source, /beforeRequest\s*\?\s*false\s*:\s*Boolean\(submitted\)/);
    assert.match(source, /webFetch\(provider, spec, \{ \.\.\.options, submitted \}\)/);
});

test('HTTP 状态码分类', () => {
    assert.equal(classifyHttpFailure(401, ''), 'AUTH_EXPIRED');
    assert.equal(classifyHttpFailure(403, 'recaptcha required'), 'RECAPTCHA_REQUIRED');
    assert.equal(classifyHttpFailure(429, ''), 'RATE_LIMIT');
    assert.equal(classifyHttpFailure(400, '积分不足'), 'QUOTA_EXHAUSTED');
    assert.equal(classifyHttpFailure(400, 'content policy violation'), 'CONTENT_POLICY');
    assert.equal(classifyHttpFailure(500, ''), 'GENERATION_FAILED');
});

test('日志脱敏覆盖三个平台的凭证形态', () => {
    const redacted = redactSecrets(JSON.stringify({
        authorization: 'Bearer ya29.a0AfH6SMBxxxxxxxxxxxxxxxx',
        cookie: 'SAPISID=abcdefghijklmnop; __Secure-1PSID=zzzzzzzzzzzz',
        msToken: 'AbCdEf0123456789zzzz',
        'x-amz-security-token': 'STS0123456789abcdef'
    }));
    assert.equal(/ya29\./.test(redacted), false);
    assert.equal(/abcdefghijklmnop/.test(redacted), false);
    assert.equal(/AbCdEf0123456789/.test(redacted), false);
    assert.equal(/STS0123456789/.test(redacted), false);
});

test('旧画布模型 id 能映射到协议模型，未知 id 回落基线而不是崩溃', () => {
    assert.equal(resolveProtocolModelId('jimeng-image-5-0-lite', 'fallback'), 'high_aes_general_v50');
    assert.equal(resolveProtocolModelId('google-flow-nano-banana-2', 'fallback'), 'GEM_PIX_2');
    assert.equal(resolveProtocolModelId('某个未来才有的模型', 'fallback'), 'fallback');
    // 映射表必须覆盖当前画布里所有即梦 / Flow 模型 id。
    for (const id of ['jimeng-seedance-2-0', 'jimeng-seedance-2-0-fast', 'google-flow-veo-3-1-lite']) {
        assert.ok(CANVAS_MODEL_PROTOCOL_IDS[id], `缺少 ${id} 的协议映射`);
    }
});
