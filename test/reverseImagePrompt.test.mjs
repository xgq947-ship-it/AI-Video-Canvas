import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildReverseImagePromptInstruction,
    REVERSE_IMAGE_PROMPT_MODES
} from '../shared/reverseImagePrompt.js';

test('正常模式保留并精确描述图片中的文字', () => {
    const instruction = buildReverseImagePromptInstruction(REVERSE_IMAGE_PROMPT_MODES.NORMAL);
    assert.match(instruction, /逐字写出文字内容/);
    assert.match(instruction, /字体风格、字号层级、颜色和排版位置/);
});

test('去文字模式忽略文案字幕并要求生成无文字画面', () => {
    const instruction = buildReverseImagePromptInstruction(REVERSE_IMAGE_PROMPT_MODES.NO_TEXT);
    assert.match(instruction, /标题、文案、字幕/);
    assert.match(instruction, /禁止转写、描述或提及这些文字/);
    assert.match(instruction, /无文字、无文案、无字幕、无标识、无水印/);
    assert.doesNotMatch(instruction, /逐字写出文字内容/);
});
