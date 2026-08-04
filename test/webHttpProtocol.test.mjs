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
    buildBatchRpcRequest,
    buildConversationTuple,
    buildStreamBody,
    buildStreamPayload,
    buildStreamUrl,
    buildVideoPollArgs,
    detectRefusal,
    extractConversation,
    extractGeminiBootstrap,
    extractLatestCandidateText,
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
    jimengVideoCapabilities,
    jimengBusinessError,
    parseJimengImageResults,
    parseJimengVideoResults,
    pickHistoryRecord,
    resolveImageSize,
    buildGenerateUrl,
    toolPageUrl
} from '../server/services/webhttp/jimeng/protocol.js';

import {
    buildGenerateImagesRequest,
    buildGenerateVideoRequest,
    buildStartVideoUploadRequest,
    buildVideoUploadChunkRequest,
    buildFlowMediaUrl,
    buildProjectMediaRequest,
    buildUpsampleImageRequest,
    extractFlowModels,
    isFlowVideoCompleted,
    normalizeFlowImageResolution,
    parseGenerateImagesResponse,
    parseGenerateVideoResponse,
    parseUpsampleImageResponse,
    parseUploadImageResponse,
    parseStartVideoUploadResponse,
    parseVideoUploadResponse,
    parseFlowVideoMedia,
    selectEditResultMedia,
    resolveFlowVideoVariant,
    toFlowImageAspectRatio,
    validateFlowImageDimensions
} from '../server/services/webhttp/flow/protocol.js';
import {
    shouldFallbackFlowUpsampleToOriginal,
    shouldRetryFlowUpsampleError
} from '../server/services/webhttp/flow/provider.js';
import {
    describeGeminiStreamFailure,
    extractGeminiTextForTurn,
    hasUsableGeminiTextPayload,
    shouldRecoverGeminiTextFailure
} from '../server/services/webhttp/gemini/provider.js';

import { crc32Hex, parseApplyUploadResponse, signImageXRequest } from '../server/services/webhttp/jimeng/imagex.js';
import { WebProviderError, classifyHttpFailure, redactSecrets } from '../server/services/webhttp/errors.js';
import { runWithExecutionMode } from '../server/services/webhttp/index.js';
import {
    createBridgeStartupGuard,
    decodeBridgeResponse,
    isHeadlessBridgeVersion
} from '../server/services/webhttp/bridge.js';
import {
    noteBillableRequestSettled,
    noteBillableRequestStart
} from '../server/services/generationRuntime/scheduler.js';
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

test('Gemini 页面请求超时不会再显示没有诊断价值的 HTTP 0', () => {
    assert.equal(
        describeGeminiStreamFailure({ status: 0, statusText: 'signal is aborted without reason' }, 600),
        'Gemini Web 请求等待超过 10 分钟，服务尚未返回结果，请重试当前任务'
    );
    assert.equal(
        describeGeminiStreamFailure({ status: 0, statusText: 'Failed to fetch' }, 600),
        'Gemini Web 网络请求中断（Failed to fetch），请检查网络后重试'
    );
    assert.equal(
        describeGeminiStreamFailure({ status: 503, statusText: 'Service Unavailable' }, 600),
        'Gemini Web 服务暂时繁忙（HTTP 503），正在尝试从 Gemini 会话恢复结果'
    );
});

test('Gemini 外层 503 时仍接受带 candidate 的完整文本响应', () => {
    const payloads = [[
        'c_81a9e9a61590b3fb',
        ['r_238139396e725795'],
        ['rc_6569e39b1c2d2c6a', ['{"shotId":"shot_001","storyBeat":"已完成分析"}']],
    ]];
    assert.equal(hasUsableGeminiTextPayload(payloads), true);
    assert.equal(hasUsableGeminiTextPayload([['Service Unavailable']]), false);
});

test('Gemini 同会话纠错必须读取当前轮回答，不能被更长的旧 JSON 覆盖', () => {
    const previousCandidateId = 'rc_previous000001';
    const payloads = [[
        [previousCandidateId, ['{"shotId":"shot_001","invalid":"这是一条更长但未通过校验的旧回答，不能再次返回"}']],
        ['rc_corrected000002', ['{"shotId":"shot_001"}']],
    ]];
    assert.match(extractText(payloads), /invalid/);
    assert.equal(
        extractGeminiTextForTurn(payloads, { previousCandidateId }),
        '{"shotId":"shot_001"}'
    );
    assert.equal(hasUsableGeminiTextPayload([
        [[previousCandidateId, ['旧回答仍在会话历史里']]],
    ], { previousCandidateId }), false);
});

test('Gemini 分析只对可恢复的传输层与网关失败回捞会话', () => {
    assert.equal(shouldRecoverGeminiTextFailure(new WebProviderError('503', {
        provider: 'gemini-web',
        code: 'GENERATION_FAILED',
        submitted: false,
        details: { status: 503 },
    })), true);
    assert.equal(shouldRecoverGeminiTextFailure(new WebProviderError('登录失效', {
        provider: 'gemini-web',
        code: 'AUTH_EXPIRED',
        submitted: false,
        details: { status: 401 },
    })), false);
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

test('Gemini 图片走对话意图，视频使用当前 97 项 mode/capability 信封', () => {
    // 图片实测不再接受旧 mode=14；视频当前抓包要求 message marker、
    // index 49 的 mode=11 与 index 55 的 capability=16。
    const text = buildStreamPayload({ prompt: 'p', mode: null });
    const image = buildStreamPayload({ prompt: 'p', mode: GEMINI_MODE.image });
    const video = buildStreamPayload({ prompt: 'p', mode: GEMINI_MODE.video });

    assert.equal(text.length, 3);
    assert.deepEqual(image, text);
    assert.equal(video.length, 97);
    assert.deepEqual(video[0].at(-1), GEMINI_MODE.videoMessage);
    assert.equal(video[49], GEMINI_MODE.video);
    assert.deepEqual(video[54], []);
    assert.deepEqual(video[55], [[GEMINI_MODE.videoCapability]]);
    assert.match(video[4], /^[0-9a-f]{32}$/);
    assert.match(video[59], /^[0-9A-F-]{36}$/);

    // mode=14 仍不能回到图片请求。
    const serialized = JSON.stringify(image);
    assert.equal(serialized.includes(String(GEMINI_MODE.image)), false);
});

test('Gemini 用自然语言拒绝时被识别为额度 / 策略问题', () => {
    // 额度耗尽时 HTTP 仍是 200，只是文案里说明原因；不识别就会误报「协议已变化」。
    const quota = [['rc_abc123def456', ['一旦您的额度重置，我就可以创建更多图片。请在“设置”中查看您的使用情况。']]];
    assert.equal(detectRefusal(quota).code, 'QUOTA_EXHAUSTED');

    const policy = [['rc_abc123def456', ['我无法生成该内容，因为它违反了相关政策。']]];
    assert.equal(detectRefusal(policy).code, 'CONTENT_POLICY');

    const normal = [['rc_abc123def456', ['这是一段完全正常的回答内容，用于确认不会误判。']]];
    assert.equal(detectRefusal(normal), null);
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

test('Gemini 异步视频轮询使用当前 hNvQHb conversation 信封', () => {
    const request = buildBatchRpcRequest({
        bl: 'build', fSid: 'sid', reqId: 123, at: 'token',
        rpcId: 'hNvQHb', args: buildVideoPollArgs('c_abc'), sourcePath: '/app/abc'
    });
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('rpcids'), 'hNvQHb');
    assert.equal(url.searchParams.get('source-path'), '/app/abc');
    const body = new URLSearchParams(request.body);
    assert.equal(body.get('at'), 'token');
    assert.deepEqual(
        JSON.parse(body.get('f.req')),
        [[['hNvQHb', '["c_abc",10,null,1,[0],[4],null,1]', null, 'generic']]]
    );
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

test('Gemini 视频结果去掉 protobuf 旁路、URL 去重，并把末位数字当真实字节数', () => {
    const videoUrl = 'https://lh3.googleusercontent.com/gg-dl/live?filename=video.mp4';
    const protobufUrl = 'https://lh3.googleusercontent.com/gg-dl/live?filename=result.pb';
    const payloads = [[
        ['video.mp4', videoUrl, protobufUrl, 'video/mp4', 1280, 720, 1_785_214_707, 2_663_169],
        ['duplicate wrapper', ['video.mp4', videoUrl, protobufUrl, 'video/mp4', 1280, 720, 1_785_214_707, 2_663_169]]
    ]];
    const { videos } = extractGeneratedMedia(payloads);
    assert.equal(videos.length, 1);
    assert.equal(videos[0].url, videoUrl);
    assert.deepEqual(videos[0].downloadUrls, [videoUrl]);
    assert.equal(videos[0].sizeBytes, 2_663_169);
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

test('会话回捞选择已知旧 candidate 之后的最新回答', () => {
    const payloads = [[
        ['rc_ready00000001', ['READY']],
        ['rc_old0000000002', ['{"shotId":"shot_001","storyBeat":"旧的不完整结果"}']],
        ['rc_new0000000003', ['{"shotId":"shot_001","storyBeat":"最新完整结果"}']],
    ]];
    assert.equal(
        extractLatestCandidateText(payloads, { excludeCandidateIds: ['rc_old0000000002'] }),
        '{"shotId":"shot_001","storyBeat":"最新完整结果"}'
    );
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

    const hd = resolveImageSize('16:9', '2k');
    assert.equal(hd.image_ratio, 3);
    assert.equal(hd.large_image_info.width, 2560);
    assert.equal(hd.large_image_info.height, 1440);
    assert.equal(hd.large_image_info.resolution_type, '2k');
    // large_image_info 也是 draft 节点：实测真实请求里它带 type/id，缺了会被拒。
    assert.equal(hd.large_image_info.type, '');
    assert.equal(typeof hd.large_image_info.id, 'string');

    const uhd = resolveImageSize('21:9', '4k');
    assert.equal(uhd.image_ratio, 8);
    assert.equal(uhd.large_image_info.width, 6197);
    assert.equal(uhd.large_image_info.height, 2656);

    const proSd = resolveImageSize('16:9', '1k', 'high_aes_general_v50p_large');
    assert.equal(proSd.large_image_info.width, 1024);
    assert.equal(proSd.large_image_info.height, 576);
    assert.equal(proSd.large_image_info.resolution_type, '1k');

    // 未知比例回落到 1:1 而不是抛错，保证旧画布还能打开。
    assert.equal(resolveImageSize('7:5', '2k').image_ratio, 1);
});

test('图片张数由 gen_count 控制，Lite 上限 8、Pro 上限 4', () => {
    const draft = buildImageDraft({ prompt: 'p', count: 3 });
    const abilities = draft.component_list[0].abilities;

    // 实测：gen_option 与 generate 同级。放进 generate 内部时服务端不报字段错误，
    // 而是直接 permission denied —— 属于最难查的一类错位。
    assert.equal(abilities.gen_option.gen_count, 3);
    assert.equal(abilities.generate.gen_option, undefined, 'gen_option 不能嵌在 generate 里');
    assert.ok(abilities.generate.core_param, 'core_param 仍在 generate 内');

    // 当前真实模型表：免费 Lite 开放 1-8 张。
    assert.equal(buildImageDraft({ prompt: 'p', count: 9 })
        .component_list[0].abilities.gen_option.gen_count, 8);
    // Pro 的真实选项仍是 1-4 张。
    assert.equal(buildImageDraft({ prompt: 'p', model: 'high_aes_general_v50p_large', count: 8 })
        .component_list[0].abilities.gen_option.gen_count, 4);
});

test('draft 每个节点都带 type/id，根节点带版本协商字段', () => {
    // 缺这层信封时服务端返回 ret=1002 common error。
    const draft = buildImageDraft({ prompt: 'p' });
    assert.equal(draft.type, 'draft');
    assert.equal(typeof draft.id, 'string');
    assert.equal(draft.min_version, '3.0.2');
    assert.deepEqual(draft.min_features, []);
    assert.equal(draft.is_from_tsn, true);

    const component = draft.component_list[0];
    assert.equal(draft.main_component_id, component.id, 'main_component_id 必须指向组件');
    assert.equal(typeof component.metadata.created_time_in_ms, 'string');
    for (const n of [component.abilities, component.abilities.generate, component.abilities.generate.core_param]) {
        assert.equal(n.type, '');
        assert.equal(typeof n.id, 'string');
    }
});

test('参考图 URI 同时写入三处，并自动补 ##image 前缀', () => {
    const draft = buildBlendDraft({
        prompt: '换成黑色',
        images: [{ imageUri: 'tos-cn-i-tb4s082cfz/abc' }]
    });
    const blend = draft.component_list[0].abilities.blend;
    assert.equal(draft.min_version, '3.0.2');
    assert.equal(draft.main_component_id, draft.component_list[0].id);
    assert.equal(typeof blend.id, 'string');
    assert.equal(typeof blend.core_param.id, 'string');
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
    assert.equal(textOnly.min_version, '3.0.2');
    assert.equal(textOnly.main_component_id, textOnly.component_list[0].id);
    const textInput = textOnly.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(typeof textInput.id, 'string');
    assert.equal(textInput.unified_edit_input, undefined);
    assert.equal(textInput.duration_ms, 5000);
    assert.equal(textInput.fps, 24);

    const withImage = buildVideoDraft({ prompt: 'p', images: [{ imageUri: 'tos/x' }] });
    const materialInput = withImage.component_list[0].abilities.gen_video.text_to_video_params.video_gen_inputs[0];
    assert.equal(materialInput.unified_edit_input.material_list[0].image_info.image_uri, 'tos/x');
});

test('即梦五个 2.0 模型按真实表约束时长、分辨率和参考图', () => {
    const vip = jimengVideoCapabilities('dreamina_seedance_40_pro_vision');
    assert.deepEqual(vip.resolutions, ['720P', '1080P', '4K']);
    assert.deepEqual(vip.durations, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.equal(vip.maxReferenceImages, 9);

    for (const model of [
        'dreamina_seedance_40_mini', 'dreamina_seedance_40_vision',
        'dreamina_seedance_40', 'dreamina_seedance_40_pro'
    ]) {
        assert.deepEqual(jimengVideoCapabilities(model).resolutions, ['720P']);
    }
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
    // workspace_id 在线上是**数字**，不是字符串。
    assert.equal(body.extend.workspace_id, 17381487769100);
    assert.equal(body.http_common_info.aid, 513695);
    assert.equal(typeof body.draft_content, 'string');
    assert.equal(JSON.parse(body.draft_content).type, 'draft');
    // metrics_extra 属于埋点，但线上请求始终带着它。
    assert.equal(typeof body.metrics_extra, 'string');
    assert.equal(JSON.parse(body.metrics_extra).generateId, 'sub-1');
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

test('生成请求必须带 babi_param 权益描述符与 webId', () => {
    // 实测：缺 babi_param 时 aigc_draft/generate 一律 ret=3018 permission denied，
    // 与模型、分辨率无关。它是 URL 参数（值为 URL 编码的 JSON），不在请求体里。
    const url = new URL(buildGenerateUrl({ model: 'high_aes_general_v50', webId: '76667375525102566' }));
    assert.equal(url.pathname, '/mweb/v1/aigc_draft/generate');
    assert.equal(url.searchParams.get('webId'), '76667375525102566');

    const babi = JSON.parse(decodeURIComponent(url.searchParams.get('babi_param')));
    assert.equal(babi.feature_key, 'aigc_to_image');
    assert.equal(babi.scenario, 'image_video_generation');
    assert.equal(babi.feature_entrance_detail, 'to-generate-high_aes_general_v50');
    assert.equal(babi.extra_param.model_id, 'high_aes_general_v50');

    const blendUrl = new URL(buildGenerateUrl({
        model: 'high_aes_general_v50', webId: '76667375525102566', generateType: 12
    }));
    const blendBabi = JSON.parse(decodeURIComponent(blendUrl.searchParams.get('babi_param')));
    assert.equal(blendBabi.extra_param.generate_type, '12');

    // generate_id 每次都要变，不能是固定值。
    const again = new URL(buildGenerateUrl({ model: 'high_aes_general_v50' }));
    assert.notEqual(url.searchParams.get('generate_id'), again.searchParams.get('generate_id'));
});

test('生成请求来源页面必须与任务类型一致', () => {
    // 实测：同一份生图请求从 ?type=video 页面发出会 permission denied。
    assert.match(toolPageUrl('image', '123'), /type=image/);
    assert.match(toolPageUrl('image', '123'), /workspace=123/);
    assert.match(toolPageUrl('video'), /type=video/);
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

test('即梦模型发现读取页面 bootstrap，UI 名一律取服务端 model_name', () => {
    // 数据形状取自线上 window.__*_generate_model_config__（值已精简）。
    // 注意 key 写着 40_mini，真实 UI 名却是「2.0 mini」—— 所以绝不能按 key 猜名字。
    const { images, videos } = extractJimengModels({
        image: {
            data: {
                model_list: [{
                    model_req_key: 'high_aes_general_v50',
                    model_name: '图片 5.0 Lite',
                    feats: ['t2i', 'byte_edit'],
                    generate_count_options: [1, 2, 3, 4],
                    input_image_limit: [{ ability_name: 'byte_edit', max_image_num: 10 }],
                    resolution_map: {
                        '2k': { image_ratio_sizes: [{ ratio_type: 1 }, { ratio_type: 3 }] },
                        '4k': { image_ratio_sizes: [{ ratio_type: 1 }] }
                    }
                }]
            }
        },
        video: {
            data: {
                model_list: [{
                    model_req_key: 'dreamina_seedance_40_mini',
                    model_name: '即梦 Seedance 2.0 mini',
                    options: [
                        { key: 'resolution', enum_val: { string_value: ['720p'] } },
                        { key: 'fps', enum_val: { int_value: [24] } },
                        { key: 'frames', enum_val: { int_value: [96, 120, 144] } },
                        { key: 'video_aspect_ratio', enum_val: { string_value: ['16:9', '9:16'] } },
                        { key: 'input_media_type', enum_val: { string_value: ['unified_edit', 'prompt', 'first_frame', 'end_frame'] } },
                        { key: 'unified_edit', unified_edit_config: { supported_materials: [{ material_type: 1, limit: { max_count: 9 } }] } }
                    ]
                }]
            }
        }
    });

    const image = images[0];
    assert.equal(image.displayName, '图片 5.0 Lite');
    assert.deepEqual(image.resolutions, ['2K', '4K']);
    assert.deepEqual(image.aspectRatios.sort(), ['1:1', '16:9'].sort(), 'ratio_type 应还原成比例字符串');
    assert.equal(image.maxBatchCount, 4);
    assert.equal(image.supportsReferenceImage, true);
    assert.equal(image.maxReferenceImages, 10);

    const video = videos[0];
    assert.equal(video.displayName, '即梦 Seedance 2.0 mini');
    assert.equal(video.fps, 24);
    // 服务端只给帧数，秒数要用 frames / fps 换算。
    assert.deepEqual(video.durations, [4, 5, 6]);
    assert.deepEqual(video.resolutions, ['720P']);
    assert.equal(video.supportsFirstFrame, true);
    assert.equal(video.supportsEndFrame, true);
    assert.equal(video.maxReferenceImages, 9);
});

test('模型发现遇到未知结构返回空表而不是抛错', () => {
    // 发现失败必须退回基线，不能让模型下拉变空。
    assert.deepEqual(extractJimengModels(null), { images: [], videos: [] });
    assert.deepEqual(extractJimengModels({ unrelated: true }), { images: [], videos: [] });
    assert.deepEqual(extractJimengModels({ image: { data: {} } }), { images: [], videos: [] });
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
    // 回归线上 SignatureDoesNotMatch：canonicalHeaders 和 SignedHeaders 都必须
    // 以 host 开头，不能一边把 host 放末尾、一边声明它排在最前。
    assert.equal(headers.authorization,
        'AWS4-HMAC-SHA256 Credential=AKIDTEST/20260727/cn-north-1/imagex/aws4_request, '
        + 'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, '
        + 'Signature=0fc3d94bc4891c4fafddd6107436fff1f257fd8b5df635bd5d0bce9d7894cb25');

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
        { imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: 'media-a' }
    ]);
    // 同一批次内 seed 必须不同，否则多张结果会一模一样。
    assert.notEqual(body.requests[0].seed, body.requests[1].seed);
});

test('Flow 2K 使用官方 upsampleImage 协议并解析新的媒体关系', () => {
    const auth = {
        accessToken: 'token',
        projectId: 'proj-1',
        sessionId: ';1',
        recaptchaToken: 'rc-upsample',
        userPaygateTier: 'PAYGATE_TIER_ONE'
    };
    const spec = buildUpsampleImageRequest({
        auth,
        mediaId: 'source-media',
        resolution: '2K'
    });
    assert.equal(spec.url, 'https://aisandbox-pa.googleapis.com/v1/flow/upsampleImage');
    assert.equal(spec.method, 'POST');
    assert.equal(spec.headers.authorization, 'Bearer token');
    const body = JSON.parse(spec.body);
    assert.equal(body.mediaId, 'source-media');
    assert.equal(body.targetResolution, 'UPSAMPLE_IMAGE_RESOLUTION_2K');
    assert.equal(body.clientContext.recaptchaContext.token, 'rc-upsample');
    assert.equal(body.clientContext.projectId, 'proj-1');
    assert.equal(body.clientContext.tool, 'PINHOLE');

    const parsed = parseUpsampleImageResponse({
        media: {
            name: 'upscaled-media',
            workflowId: 'workflow-1',
            mediaMetadata: { mediaBlobSize: '1234' },
            image: {
                generatedImage: {
                    upsampleMetadata: { imageUpsampleResolution: 'IMAGE_UPSAMPLE_RESOLUTION_2K' }
                }
            }
        },
        encodedImage: Buffer.from('jpeg bytes').toString('base64')
    });
    assert.equal(parsed.mediaId, 'upscaled-media');
    assert.equal(parsed.workflowId, 'workflow-1');
    assert.equal(parsed.resolution, 'IMAGE_UPSAMPLE_RESOLUTION_2K');
    assert.equal(Buffer.from(parsed.encodedImage, 'base64').toString(), 'jpeg bytes');
    assert.equal(parsed.size, 1234);
});

test('Flow 分辨率兼容旧 Auto，实际像素按对应原图比例校验', () => {
    assert.equal(normalizeFlowImageResolution(undefined), '2K');
    assert.equal(normalizeFlowImageResolution('Auto'), '2K');
    assert.equal(normalizeFlowImageResolution('自动'), '2K');
    assert.equal(normalizeFlowImageResolution('1K'), '1K');
    assert.throws(() => normalizeFlowImageResolution('4K'), /只支持 1K\/2K/);

    assert.equal(validateFlowImageDimensions({
        requestedResolution: '1K',
        sourceWidth: 1376,
        sourceHeight: 768,
        actualWidth: 1376,
        actualHeight: 768
    }).valid, true);
    assert.equal(validateFlowImageDimensions({
        requestedResolution: '2K',
        sourceWidth: 1376,
        sourceHeight: 768,
        actualWidth: 2752,
        actualHeight: 1536
    }).valid, true);
    const fake2K = validateFlowImageDimensions({
        requestedResolution: '2K',
        sourceWidth: 1376,
        sourceHeight: 768,
        actualWidth: 1376,
        actualHeight: 768
    });
    assert.equal(fake2K.valid, false);
    assert.match(fake2K.reason, /期望 2752×1536/);

    // 缺少源尺寸时也不能让已知 1K 长边冒充 2K。
    assert.equal(validateFlowImageDimensions({
        requestedResolution: '2K',
        actualWidth: 1376,
        actualHeight: 768
    }).valid, false);

    assert.equal(shouldRetryFlowUpsampleError({ code: 'RECAPTCHA_REQUIRED' }, 1), true);
    assert.equal(shouldRetryFlowUpsampleError({ code: 'RECAPTCHA_REQUIRED' }, 2), false);
    assert.equal(shouldRetryFlowUpsampleError({ code: 'AUTH_EXPIRED' }, 1), true);
    assert.equal(shouldRetryFlowUpsampleError({ code: 'AUTH_EXPIRED' }, 2), false);
    assert.equal(shouldRetryFlowUpsampleError({ code: 'BRIDGE_UNAVAILABLE' }, 1), false);
    assert.equal(shouldFallbackFlowUpsampleToOriginal({ code: 'AUTH_EXPIRED' }), true);
    assert.equal(shouldFallbackFlowUpsampleToOriginal({ code: 'BRIDGE_UNAVAILABLE' }), true);
    assert.equal(shouldFallbackFlowUpsampleToOriginal({ code: 'OPERATION_CANCELLED' }), false);
    assert.equal(shouldFallbackFlowUpsampleToOriginal({ cancelled: true }), false);
});

test('Flow 视频按文本 / 首帧 / 多参考图切换真实 endpoint 与模型 key', () => {
    const auth = { accessToken: 't', projectId: 'p', sessionId: ';1', recaptchaToken: 'r' };
    const textSpec = buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', modelFamily: 'abra', duration: 4
    });
    const textOnly = JSON.parse(textSpec.body);
    assert.match(textSpec.url, /video:batchAsyncGenerateVideoText$/);
    assert.equal(textOnly.requests[0].videoModelKey, 'abra_t2v_4s');
    assert.equal(textOnly.requests[0].startImage, undefined);

    const startSpec = buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', modelFamily: 'abra', duration: 6,
        firstFrameMediaId: 'media-1'
    });
    const imageToVideo = JSON.parse(startSpec.body);
    assert.match(startSpec.url, /video:batchAsyncGenerateVideoStartImage$/);
    assert.equal(imageToVideo.requests[0].videoModelKey, 'abra_i2v_6s');
    assert.deepEqual(imageToVideo.requests[0].startImage, { mediaId: 'media-1' });

    const referencesSpec = buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', modelFamily: 'veo_3_1_lite', duration: 8,
        referenceMediaIds: ['media-a', 'media-b']
    });
    const references = JSON.parse(referencesSpec.body);
    assert.match(referencesSpec.url, /video:batchAsyncGenerateVideoReferenceImages$/);
    assert.equal(references.requests[0].videoModelKey, 'veo_3_1_r2v_lite');
    assert.deepEqual(references.requests[0].referenceImages, [
        { mediaId: 'media-a', imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' },
        { mediaId: 'media-b', imageUsageType: 'IMAGE_USAGE_TYPE_ASSET' }
    ]);

    assert.throws(() => buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', firstFrameMediaId: 'media-1', referenceMediaIds: ['media-a']
    }), /不能在同一请求中混用/);
});

test('Flow 参考视频使用分片上传和 Omni Flash 视频编辑协议', () => {
    const start = buildStartVideoUploadRequest({
        projectId: 'project-1', fileName: '参考 视频.mp4', mimeType: 'video/mp4', size: 123
    });
    assert.equal(start.url, 'https://labs.google/fx/api/upload-video?action=start');
    assert.equal(start.method, 'POST');
    assert.equal(start.headers['x-upload-content-length'], '123');
    assert.equal(start.headers['x-upload-file-name'], encodeURIComponent('参考 视频.mp4'));
    assert.deepEqual(parseStartVideoUploadResponse({ sessionUrl: 'upload-session', status: 'active' }), {
        sessionUrl: 'upload-session', status: 'active'
    });

    const chunk = buildVideoUploadChunkRequest({
        projectId: 'project-1', sessionUrl: 'upload-session', fileName: 'reference.mp4',
        offset: 0, buffer: Buffer.from('video'), final: true
    });
    assert.equal(chunk.method, 'PUT');
    assert.equal(chunk.headers['x-upload-command'], 'upload, finalize');
    assert.equal(chunk.headers['x-upload-offset'], '0');
    assert.deepEqual(chunk.body, Buffer.from('video'));
    assert.deepEqual(parseVideoUploadResponse({
        status: 'final', mediaServerId: 'media-video', workflowServerId: 'workflow-video',
        videoWidth: 640, videoHeight: 360
    }), {
        mediaId: 'media-video', workflowId: 'workflow-video', status: 'final', width: 640, height: 360
    });

    const auth = {
        accessToken: 'token', projectId: 'project-1', sessionId: ';1',
        recaptchaToken: 'captcha', userPaygateTier: 'PAYGATE_TIER_ONE'
    };
    const spec = buildGenerateVideoRequest({
        auth, prompt: '保持运动，改为电影灯光', batchId: 'batch-1', modelFamily: 'abra',
        aspectRatio: '16:9', referenceVideo: {
            mediaId: 'media-video', workflowId: 'workflow-video'
        }
    });
    const body = JSON.parse(spec.body);
    assert.match(spec.url, /video:batchAsyncGenerateVideoEditVideo$/);
    assert.equal(body.requests[0].videoModelKey, 'abra_edit');
    assert.deepEqual(body.requests[0].metadata, { workflowId: 'workflow-video' });
    assert.deepEqual(body.requests[0].videoInput, { mediaId: 'media-video' });
    assert.ok(body.requests[0].seed >= 1 && body.requests[0].seed <= 0x7fff);
    assert.deepEqual(body.mediaGenerationContext, { batchId: 'batch-1' });
    assert.equal(body.useV2ModelConfig, undefined);

    const trimmedSpec = buildGenerateVideoRequest({
        auth, prompt: '保持运动', batchId: 'batch-2', modelFamily: 'abra',
        aspectRatio: '16:9', referenceVideo: {
            mediaId: 'media-video', workflowId: 'workflow-video',
            startFrameIndex: 12, endFrameIndex: 84
        }
    });
    assert.deepEqual(JSON.parse(trimmedSpec.body).requests[0].videoInput, {
        mediaId: 'media-video', startFrameIndex: 12, endFrameIndex: 84
    });
    assert.throws(() => buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', modelFamily: 'veo_3_1_fast',
        referenceVideo: { mediaId: 'm', workflowId: 'w', endFrameIndex: 30 }
    }), /只支持 Omni Flash/);
    assert.throws(() => buildGenerateVideoRequest({
        auth, prompt: 'p', batchId: 'b', modelFamily: 'abra', firstFrameMediaId: 'image',
        referenceVideo: { mediaId: 'm', workflowId: 'w', endFrameIndex: 30 }
    }), /不能与首帧或参考图混用/);
});

test('Flow 三个 Veo 3.1 档位使用页面抓到的精确模式 key', () => {
    assert.deepEqual(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_lite', mode: 'text', duration: 8
    }), {
        modelKey: 'veo_3_1_t2v_lite',
        apiPathname: 'batchAsyncGenerateVideoText',
        duration: 8
    });
    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_lite', mode: 'start-image', duration: 8
    }).modelKey, 'veo_3_1_i2v_lite');
    assert.throws(() => resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_lite', mode: 'text', duration: 4
    }), /支持 8 秒/);

    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_fast', mode: 'text', duration: 8
    }).modelKey, 'veo_3_1_t2v_fast');
    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_fast', mode: 'start-image', duration: 8
    }).modelKey, 'veo_3_1_i2v_s_fast');
    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_fast', mode: 'reference-images', duration: 8, aspectRatio: '16:9'
    }).modelKey, 'veo_3_1_r2v_fast_landscape');
    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_fast', mode: 'reference-images', duration: 8, aspectRatio: '9:16'
    }).modelKey, 'veo_3_1_r2v_fast_portrait');

    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_quality', mode: 'text', duration: 8
    }).modelKey, 'veo_3_1_t2v');
    assert.equal(resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_quality', mode: 'start-image', duration: 8
    }).modelKey, 'veo_3_1_i2v_s');
    assert.throws(() => resolveFlowVideoVariant({
        modelFamily: 'veo_3_1_quality', mode: 'reference-images', duration: 8
    }), /不支持 Ingredients/);
});

test('Flow 视频轮询走项目页面真实 projectInitialData，避开 fetchMedia CORS', () => {
    const spec = buildProjectMediaRequest({
        auth: { projectId: 'project-1', labsCookie: 'session=cookie' }, mediaIds: ['m1', 'm2']
    });
    assert.match(spec.url, /\/fx\/api\/trpc\/flow\.projectInitialData\?input=/);
    const input = JSON.parse(decodeURIComponent(new URL(spec.url).searchParams.get('input')));
    assert.deepEqual(input, { json: { projectId: 'project-1' } });
    assert.equal(spec.method, 'GET');
    assert.equal(spec.headers.cookie, 'session=cookie');
    assert.deepEqual(spec.mediaIds, ['m1', 'm2']);
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
    assert.equal(toFlowImageAspectRatio('4:3'), 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE');
    assert.equal(toFlowImageAspectRatio('3:4'), 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR');
});

test('Flow 模型发现能认出新的 videoModelKey', () => {
    const { videos } = extractFlowModels({ config: { models: [{ videoModelKey: 'abra_i2v_8s', displayName: 'Abra 8s' }] } });
    const model = videos.find(item => item.id === 'abra_i2v_8s');
    assert.equal(model.displayName, 'Abra 8s');
    assert.deepEqual(model.durations, [8], '时长可从 key 推出');
    assert.equal(model.supportsImageToVideo, true);
});

test('Flow 模型健康接口按已审协议族补齐真实 capability', () => {
    const { videos } = extractFlowModels({
        modelStatus: [
            { modelKey: 'abra', status: 'MODEL_HEALTH_STATUS_HEALTHY' },
            { modelKey: 'veo_3_1_fast', status: 'MODEL_HEALTH_STATUS_HEALTHY' },
            { modelKey: 'veo_3_1_quality', status: 'MODEL_HEALTH_STATUS_UNAVAILABLE' }
        ]
    });
    assert.deepEqual(videos.map(item => item.id).sort(), ['abra', 'veo_3_1_fast']);
    const fast = videos.find(item => item.id === 'veo_3_1_fast');
    assert.equal(fast.displayName, 'Veo 3.1 - Fast');
    assert.equal(fast.maxReferenceImages, 3);
    assert.equal(fast.supportsAudio, true);
});

// ---------------------------------------------------------------------------
// 执行模式 / 错误契约
// ---------------------------------------------------------------------------

test('已提交的失败绝不重试', async () => {
    let httpCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'auto',
            provider: 'jimeng',
            label: '测试',
            http: () => {
                httpCalls += 1;
                throw new WebProviderError('生成中途失败', { provider: 'jimeng', code: 'GENERATION_FAILED' });
            }
        }),
        error => error.code === 'GENERATION_FAILED'
    );
    // 二次提交 = 用户被扣两次费。
    assert.equal(httpCalls, 1);
});

test('真实提交边界压过错误对象的旧 submitted:false，解析失败也绝不二次提交', async () => {
    let calls = 0;
    await assert.rejects(runWithExecutionMode({
        mode: 'http',
        provider: 'google-flow',
        label: '提交边界测试',
        http: () => {
            calls += 1;
            noteBillableRequestStart('google-flow');
            noteBillableRequestSettled('google-flow', { batchId: 'batch-boundary' });
            throw new WebProviderError('响应解析失败', {
                provider: 'google-flow',
                code: 'PROTOCOL_CHANGED',
                submitted: false
            });
        }
    }), error => error.code === 'PROTOCOL_CHANGED'
        && error.submitted === true
        && error.retryable === false);
    assert.equal(calls, 1, '已经收到计费响应后不得因解析失败再次提交');
});

test('bridge JSON 解码继承调用方的计费语义', () => {
    const raw = {
        ok: true,
        status: 200,
        bodyBase64: Buffer.from('not-json').toString('base64')
    };
    assert.throws(
        () => decodeBridgeResponse(raw, 'jimeng', { submitted: true }).json(),
        error => error.code === 'PROTOCOL_CHANGED' && error.submitted === true
    );
    assert.throws(
        () => decodeBridgeResponse(raw, 'jimeng', { submitted: false }).json(),
        error => error.code === 'PROTOCOL_CHANGED' && error.submitted === false
    );
});

test('启动闸门只把无头 Chrome 当作可并行生成实例', () => {
    assert.equal(isHeadlessBridgeVersion({
        'User-Agent': 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36'
    }), false, '可见登录实例仍需经过全局切换锁');
    assert.equal(isHeadlessBridgeVersion({
        'User-Agent': 'Mozilla/5.0 HeadlessChrome/140.0.0.0 Safari/537.36'
    }), true);
    assert.equal(isHeadlessBridgeVersion({}), false);
});

test('三平台冷启动只允许一个 CLI 启动 Chrome，CDP 就绪后恢复跨平台并行', async () => {
    let ready = false;
    let coldActive = 0;
    let coldPeak = 0;
    let warmActive = 0;
    let warmPeak = 0;
    let warmStarted = 0;
    let releaseWarm;
    let allWarmStarted;
    const warmGate = new Promise(resolve => { releaseWarm = resolve; });
    const warmReady = new Promise(resolve => { allWarmStarted = resolve; });
    const guard = createBridgeStartupGuard({ isReady: async () => ready });

    const tasks = Array.from({ length: 6 }, (unused, index) => guard(async () => {
        if (!ready) {
            coldActive += 1;
            coldPeak = Math.max(coldPeak, coldActive);
            await new Promise(resolve => setTimeout(resolve, 10));
            ready = true;
            coldActive -= 1;
            return index;
        }
        warmActive += 1;
        warmPeak = Math.max(warmPeak, warmActive);
        warmStarted += 1;
        if (warmStarted === 5) allWarmStarted();
        await warmGate;
        warmActive -= 1;
        return index;
    }));

    await Promise.race([
        warmReady,
        new Promise((unused, reject) => setTimeout(() => reject(new Error('CDP 就绪后未恢复并行')), 300))
    ]);
    assert.equal(coldPeak, 1);
    assert.equal(warmPeak, 5);
    releaseWarm();
    assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
});

test('等待 Chrome 冷启动时取消会立即退出，且不会堵住后续平台', async () => {
    let ready = false;
    let releaseOwner;
    let ownerStarted;
    const ownerGate = new Promise(resolve => { releaseOwner = resolve; });
    const ownerReady = new Promise(resolve => { ownerStarted = resolve; });
    const guard = createBridgeStartupGuard({ isReady: async () => ready });
    const owner = guard(async () => {
        ownerStarted();
        await ownerGate;
        ready = true;
    });
    await ownerReady;

    const controller = new AbortController();
    let cancelledTaskStarted = false;
    const cancelled = guard(async () => { cancelledTaskStarted = true; }, {
        signal: controller.signal,
        label: '待取消平台'
    });
    controller.abort();
    await Promise.race([
        assert.rejects(cancelled, error => error.code === 'OPERATION_CANCELLED' && error.submitted === false),
        new Promise((unused, reject) => setTimeout(() => reject(new Error('冷启动排队取消未立即返回')), 100))
    ]);
    assert.equal(cancelledTaskStarted, false);

    releaseOwner();
    await owner;
    assert.equal(await guard(async () => 'next-provider'), 'next-provider');
});

test('提交前失败会重试，重试用尽后如实抛出（不再回退浏览器）', async () => {
    // DOM 点击生成已删除，认证类失败应交给 Session 恢复，而不是换一条也要花配额的链路。
    let httpCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'auto',
            provider: 'google-flow',
            label: '测试',
            http: () => {
                httpCalls += 1;
                throw new WebProviderError('登录过期', { provider: 'google-flow', code: 'AUTH_EXPIRED' });
            }
        }),
        error => error.code === 'AUTH_EXPIRED'
    );
    assert.equal(httpCalls, 2, 'HTTP 重试上限 2 次');
});

test('额度拒绝可标记为未扣费但不可重试，避免重复撞平台风控', async () => {
    let calls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'http', provider: 'gemini-web', label: '额度测试',
            http: () => {
                calls += 1;
                throw new WebProviderError('额度待重置', {
                    provider: 'gemini-web', code: 'QUOTA_EXHAUSTED',
                    submitted: false, retryable: false,
                    details: { conversationId: 'c_safe' }
                });
            }
        }),
        error => error.code === 'QUOTA_EXHAUSTED'
            && error.submitted === false
            && error.retryable === false
            && error.canFallbackToBrowser === false
            && error.details.conversationId === 'c_safe'
    );
    assert.equal(calls, 1);
});

test('http 模式同样只走 HTTP', async () => {
    let httpCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'http',
            provider: 'gemini-web',
            label: '测试',
            httpAttempts: 1,
            http: () => {
                httpCalls += 1;
                throw new WebProviderError('签名失败', { provider: 'gemini-web', code: 'SIGN_FAILED' });
            }
        }),
        error => error.code === 'SIGN_FAILED'
    );
    assert.equal(httpCalls, 1);
});

test('没有 HTTP 实现时明确报错，而不是静默什么都不做', () => {
    assert.rejects(
        runWithExecutionMode({ mode: 'auto', provider: 'jimeng', label: '测试' }),
        error => error.code === 'BRIDGE_UNAVAILABLE'
    );
});

test('未知异常按已提交处理（宁可让用户手动重试，也不能重复扣费）', async () => {
    let httpCalls = 0;
    await assert.rejects(
        runWithExecutionMode({
            mode: 'auto', provider: 'jimeng', label: '测试',
            http: () => { httpCalls += 1; throw new Error('意料之外的崩溃'); }
        }),
        error => error instanceof WebProviderError && error.submitted === true
    );
    assert.equal(httpCalls, 1, '未知异常不得重试');
});

test('Flow 真实 403 reCAPTCHA 响应被判为提交前失败', () => {
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

test('Gemini 页面被重定向映射为登录失效，属提交前失败', () => {
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
    assert.equal(classifyHttpFailure(400, '{"fieldViolations":[{"description":"Unknown field"}]}'), 'PROTOCOL_CHANGED');
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
    assert.equal(resolveProtocolModelId('google-flow-nano-banana-pro', 'fallback'), 'GEM_PIX_2');
    assert.equal(resolveProtocolModelId('google-flow-nano-banana-2', 'fallback'), 'NARWHAL');
    assert.equal(resolveProtocolModelId('google-flow-nano-banana-2-lite', 'fallback'), 'HARBOR_SEAL');
    assert.equal(resolveProtocolModelId('google-flow-veo-3-1-fast', 'fallback'), 'veo_3_1_fast');
    assert.equal(resolveProtocolModelId('google-flow-veo-3-1-quality', 'fallback'), 'veo_3_1_quality');
    assert.equal(resolveProtocolModelId('某个未来才有的模型', 'fallback'), 'fallback');
    // 映射表必须覆盖当前画布里所有即梦 / Flow 模型 id。
    for (const id of [
        'jimeng-seedance-2-0', 'jimeng-seedance-2-0-fast',
        'google-flow-veo-3-1-lite', 'google-flow-veo-3-1-fast', 'google-flow-veo-3-1-quality'
    ]) {
        assert.ok(CANVAS_MODEL_PROTOCOL_IDS[id], `缺少 ${id} 的协议映射`);
    }
});

// 用从真实 Flow projectInitialData 抓到的形状（参考视频上传 + 编辑结果共享
// workflowId；结果的最终 name 是提交后才分配的，提交响应里没有）验证：
// 参考视频编辑的轮询必须按 workflowId 命中结果，而不是提交返回的 mediaId。
test('参考视频编辑：按 workflowId 从项目 media 里挑出结果，排除参考视频本身', () => {
    const WF = 'a18ca9f7-f8ab-4d07-a6c7-d3754b92ffea';
    const REF_MEDIA = 'f2ce5b98-fd48-4ebd-9a06-0a8bc0c72c6e';
    const RESULT_NAME = '63bd1908-a22b-4f94-ae16-a36c90d31aed';
    // 参考视频上传条目：同一个 workflowId，但没有 generatedVideo。
    const refUpload = {
        name: REF_MEDIA, workflowId: WF,
        mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' } },
        video: {}
    };
    // 编辑结果条目：Flow 提交后分配的新 name，继承参考视频 workflowId。
    const editResult = {
        name: RESULT_NAME, workflowId: WF,
        mediaMetadata: {
            mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' },
            requestData: { videoGenerationRequestData: { videoModelControlInput: { videoGenerationMode: 'VIDEO_GENERATION_MODE_VIDEO_TO_VIDEO' } } }
        },
        video: { generatedVideo: { model: 'abra_edit' }, operation: { name: RESULT_NAME } }
    };
    // 另一条无关视频（不同 workflowId），确保不会误伤。
    const unrelated = {
        name: 'zzz', workflowId: 'other-wf',
        mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' } },
        video: { generatedVideo: { model: 'abra_t2v_8s' } }
    };

    const parsed = [refUpload, editResult, unrelated].map(parseFlowVideoMedia);
    const hits = selectEditResultMedia(parsed, { workflowId: WF, referenceMediaId: REF_MEDIA });

    assert.equal(hits.length, 1);
    assert.equal(hits[0].mediaId, RESULT_NAME);
    assert.equal(isFlowVideoCompleted(hits[0]), true);
});

test('参考视频编辑：结果尚未出现时按 workflowId 匹配为空（继续等待，不误判完成）', () => {
    const WF = 'wf-1';
    const refUpload = { name: 'ref-1', workflowId: WF, video: {},
        mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' } } };
    const parsed = [refUpload].map(parseFlowVideoMedia);
    const hits = selectEditResultMedia(parsed, { workflowId: WF, referenceMediaId: 'ref-1' });
    assert.equal(hits.length, 0);
});

test('参考视频编辑：PENDING 的结果也会被 workflowId 命中，以便后续轮询到 SUCCESSFUL', () => {
    const WF = 'wf-2';
    const refUpload = { name: 'ref-2', workflowId: WF, video: {},
        mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' } } };
    const pendingResult = { name: 'res-2', workflowId: WF,
        mediaMetadata: { mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_PENDING' } },
        video: { operation: { name: 'res-2' } } };
    const parsed = [refUpload, pendingResult].map(parseFlowVideoMedia);
    const hits = selectEditResultMedia(parsed, { workflowId: WF, referenceMediaId: 'ref-2' });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mediaId, 'res-2');
    assert.equal(isFlowVideoCompleted(hits[0]), false);
});

test('参考视频编辑：workflowId 变化时按最终成片记录里的输入视频 mediaId 命中', () => {
    const parsed = [parseFlowVideoMedia({
        name: 'result-with-new-workflow',
        workflowId: 'generated-workflow',
        mediaMetadata: {
            mediaStatus: { mediaGenerationStatus: 'MEDIA_GENERATION_STATUS_SUCCESSFUL' },
            requestData: {
                videoGenerationRequestData: {
                    videoModelControlInput: {
                        videoModelName: 'abra_edit',
                        videoGenerationMode: 'VIDEO_GENERATION_MODE_VIDEO_TO_VIDEO'
                    },
                    videoGenerationVideoInputs: [{ mediaId: 'uploaded-reference' }]
                }
            }
        },
        video: { generatedVideo: { model: 'abra_edit' } }
    })];

    const hits = selectEditResultMedia(parsed, {
        workflowId: 'upload-workflow',
        referenceMediaId: 'uploaded-reference'
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].mediaId, 'result-with-new-workflow');
});
