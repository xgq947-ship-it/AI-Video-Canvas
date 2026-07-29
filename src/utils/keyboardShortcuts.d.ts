export function isTextEditingTarget(target: Element | null): boolean;
export function canvasHistoryShortcut(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'key'>): 'undo' | 'redo' | null;
