export function isTextEditingTarget(target) {
  if (!target) return false;
  const tagName = String(target.tagName || '').toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('[contenteditable="true"], [role="textbox"]'));
}

export function canvasHistoryShortcut(event) {
  const modifier = Boolean(event?.metaKey || event?.ctrlKey);
  if (!modifier) return null;
  const key = String(event?.key || '').toLowerCase();
  if (key === 'z' && !event?.shiftKey) return 'undo';
  if (key === 'y' || (key === 'z' && event?.shiftKey)) return 'redo';
  return null;
}
