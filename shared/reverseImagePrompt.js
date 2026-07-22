export const REVERSE_IMAGE_PROMPT_MODES = Object.freeze({
    NORMAL: 'normal',
    NO_TEXT: 'no-text'
});

export function buildReverseImagePromptInstruction(mode = REVERSE_IMAGE_PROMPT_MODES.NORMAL) {
    const modeInstruction = mode === REVERSE_IMAGE_PROMPT_MODES.NO_TEXT
        ? [
            '完全忽略画面中的标题、文案、字幕、标签文字、品牌字样、水印、角标、按钮文字和其他任何可见文字。',
            '提示词中禁止转写、描述或提及这些文字，也不要描述字体、字号、文字颜色、排版位置或文案区域。',
            '把画面理解为移除全部文字后的纯视觉画面，并在最终提示词中明确要求：无文字、无文案、无字幕、无标识、无水印。'
        ].join('\n')
        : '如果画面包含文字，必须逐字写出文字内容，并说明字体风格、字号层级、颜色和排版位置。';

    return [
        '你是专业的图像反推提示词专家。只分析提供的这一张图片，输出一段可直接用于文生图模型的中文提示词，目标是尽可能复现同一画面。',
        '必须准确描述主体数量、身份特征、外貌、服装、姿态、表情、物体、环境、构图、景别、视角、镜头、光线、色彩、材质、画面风格和清晰度。',
        modeInstruction,
        '只输出最终提示词，不要标题、解释、分析过程、Markdown，也不要出现“参考图”“原图”或“这张图片”等表述。'
    ].join('\n');
}
