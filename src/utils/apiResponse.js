const DEFAULT_BACKEND_RESTART_MESSAGE =
  '当前运行的 Evan 后台版本过旧。请完全退出 Evan AI Video Canvas（不是只关闭窗口），重新打开后再试。';

function looksLikeHtml(text) {
  const normalized = String(text || '').trim().toLowerCase();
  return normalized.startsWith('<!doctype html')
    || normalized.startsWith('<html')
    || normalized.includes('<head>')
    || normalized.includes('<body>');
}

export async function readApiResponse(response, fallbackMessage) {
  const text = await response.text();
  let data;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!response.ok) {
    if (
      response.status === 404
      && (!data || looksLikeHtml(text) || /\bCannot\s+(GET|POST|PUT|DELETE|PATCH)\b/i.test(text))
    ) {
      throw new Error(DEFAULT_BACKEND_RESTART_MESSAGE);
    }

    const serverMessage = data && typeof data.error === 'string' ? data.error.trim() : '';
    throw new Error(serverMessage || `${fallbackMessage}（HTTP ${response.status}）`);
  }

  return data;
}

export { DEFAULT_BACKEND_RESTART_MESSAGE };
