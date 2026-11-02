export interface XAccount {
  id: string;
  username: string;
  name: string;
  protected: boolean;
  profileImageUrl: string | null;
}

const reserved = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'settings', 'login', 'logout', 'signup', 'intent', 'i', 'share', 'compose', 'tos', 'privacy']);
export function xProfile(input: string): { username: string; url: string } | null {
  let value = input.trim();
  if (/^@[a-z\d_]{1,15}$/i.test(value)) value = `https://x.com/${value.slice(1)}`;
  else if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !/^(?:(?:www|mobile|m)\.)?(?:x|twitter)\.com$/i.test(url.hostname)) return null;
    const username = /^\/([a-z\d_]{1,15})\/?$/i.exec(url.pathname)?.[1].toLowerCase();
    return username && !reserved.has(username) ? { username, url: `https://x.com/${username}` } : null;
  } catch { return null; }
}

export const X_CALLBACK_QUERY = 'x_callback';
export const xCallbackUrl = (origin: string) => `${new URL(origin).origin}/?${X_CALLBACK_QUERY}=1`;
