function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function filenameFromMediaUrl(value) {
  const raw = cleanName(value);
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return '';

  try {
    const pathname = /^https?:\/\//i.test(raw)
      ? new URL(raw).pathname
      : raw.split(/[?#]/, 1)[0];
    const filename = pathname.split('/').filter(Boolean).pop() || '';
    return cleanName(decodeURIComponent(filename));
  } catch {
    return '';
  }
}

function defaultImagePrefix(node) {
  const provider = `${node?.imageModel || ''} ${node?.model || ''}`.toLowerCase();
  if (provider.includes('google-flow') || provider.includes('flow')) return 'Flow 图片';
  if (provider.includes('jimeng') || provider.includes('即梦')) return '即梦图片';
  return '图片';
}

export function resolveImageNodeDisplayName(node, ordinal = 1) {
  const displayName = cleanName(node?.displayName);
  if (displayName) return displayName;

  const filename = filenameFromMediaUrl(
    node?.resultUrl || node?.editorBackgroundUrl || node?.lastFrame || node?.mediaUrl
  );
  if (filename) return filename;

  const resultName = cleanName(node?.resultName || node?.assetName || node?.title);
  if (resultName) return resultName;

  const sequence = String(Math.max(1, Number(ordinal) || 1)).padStart(3, '0');
  return `${defaultImagePrefix(node)} ${sequence}`;
}
