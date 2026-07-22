export type ReverseImagePromptMode = 'normal' | 'no-text';

export const REVERSE_IMAGE_PROMPT_MODES: Readonly<{
    NORMAL: 'normal';
    NO_TEXT: 'no-text';
}>;

export function buildReverseImagePromptInstruction(mode?: ReverseImagePromptMode): string;
