import { apiRequest, getStoredToken } from './api';

export const OPML_BROWSER_PANEL = 'opml';

export async function downloadOpml(signal: AbortSignal) {
  const session = getStoredToken();
  const file = await apiRequest('/api/opml/export', { cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal }, 'blob');
  if (signal.aborted || getStoredToken() !== session) return;
  if (!/^text\/x-opml(?:;|$)/i.test(file.type) || !file.size) throw new Error('OPML 파일을 받지 못했어요. 다시 시도해 주세요.');

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'feedex-subscriptions.opml';
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally {
    link.remove();
    // 브라우저가 파일 읽기를 시작할 시간을 준 뒤 임시 주소를 없앤다.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
