import { getStoredToken } from './api';
import { X_CALLBACK_QUERY } from '../shared/xFeed';

export interface XConfig { configured: boolean; clientId: string | null; redirectUri: string }
const pendingKey = 'sfeed_x_oauth_pending';
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const digest = async (value: string) => base64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

export async function xAuthorization(config: XConfig, token = getStoredToken(), storage: Storage = sessionStorage): Promise<string> {
  if (!config.configured || !config.clientId) throw new Error('X 개발자 앱이 아직 연결되지 않았습니다.');
  if (!token) throw new Error('SFeed에 다시 로그인해 주세요.');
  const verifier = base64(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64(crypto.getRandomValues(new Uint8Array(32)));
  storage.setItem(pendingKey, JSON.stringify({ state, verifier, session: await digest(token), created: Date.now() }));
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
    scope: 'tweet.read users.read follows.read', state, code_challenge: await digest(verifier), code_challenge_method: 'S256' }).toString();
  return url.href;
}

export async function consumeXCallback(search: string, token = getStoredToken(), storage: Storage = sessionStorage): Promise<{ code: string; verifier: string } | null> {
  const params = new URLSearchParams(search);
  if (!params.has(X_CALLBACK_QUERY)) return null;
  const raw = storage.getItem(pendingKey); storage.removeItem(pendingKey);
  let pending: { state?: string; verifier?: string; session?: string; created?: number };
  try { pending = JSON.parse(raw || 'null'); } catch { throw new Error('X 연결 요청을 확인할 수 없습니다. 다시 연결해 주세요.'); }
  if (!pending || !token || pending.state !== params.get('state') || typeof pending.verifier !== 'string' || !Number.isFinite(pending.created) || Date.now() - pending.created! > 600_000 || pending.created! > Date.now() || pending.session !== await digest(token)) throw new Error('X 연결 요청이 만료됐거나 계정이 바뀌었습니다. 다시 연결해 주세요.');
  if (params.has('error')) throw new Error('X 연결이 취소됐습니다. 다시 연결할 수 있습니다.');
  const code = params.get('code');
  if (!code || code.length > 2048) throw new Error('X 로그인 응답을 확인하지 못했습니다. 다시 연결해 주세요.');
  return { code, verifier: pending.verifier };
}
