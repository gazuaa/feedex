import { Hono } from 'hono';
import type { Env, UserRecord } from './types';
import { xCallbackUrl, xProfile, type XAccount } from '../shared/xFeed';
import { canManageX, readXCredentials, saveXCredentials, XSettingsError } from './xSettings';

type Connection = { sub: string; xId: string; token: string; expires: number };
export class XConnectionError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 429 | 502 | 503 = 502) { super(message); }
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (value) => value.charCodeAt(0));
async function encryptionKey(env: Env) {
  const credentials = await readXCredentials(env);
  if (!credentials) throw new XConnectionError('X 연결 설정을 먼저 완료해 주세요.', 503);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sfeed-x-v1:${credentials.clientSecret}`));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env: Env, connection: Connection): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sfeed-x-v1') }, await encryptionKey(env), new TextEncoder().encode(JSON.stringify(connection)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
async function unseal(env: Env, sealed: unknown, userId: string): Promise<Connection> {
  const key = await encryptionKey(env);
  try {
    if (typeof sealed !== 'string' || sealed.length > 12_000) throw new Error();
    const parts = sealed.split('.'); if (parts.length !== 2) throw new Error();
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]), additionalData: new TextEncoder().encode('sfeed-x-v1') }, key, decode(parts[1]));
    const value = JSON.parse(new TextDecoder().decode(decrypted)) as Connection;
    if (value.sub !== userId || !/^\d{1,20}$/.test(value.xId) || typeof value.token !== 'string' || !Number.isFinite(value.expires) || value.expires <= Date.now()) throw new Error();
    return value;
  } catch { throw new XConnectionError('X 연결이 만료됐습니다. X 계정을 다시 연결해 주세요.', 401); }
}

async function xJson(path: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
  const step = path === '2/oauth2/token' ? 'token' : path === '2/users/me' ? 'profile' : 'following';
  const label = step === 'token' ? 'X 로그인 승인 확인' : step === 'profile' ? 'X 계정 확인' : '팔로우 목록 조회';
  let upstreamStatus: number | null = null;
  try {
    // Workers는 redirect: 'error'를 지원하지 않는다. 직접 3xx를 거절해 인증정보가 다른 주소로 전달되지 않게 한다.
    const response = await fetch(`https://api.x.com/${path}`, { ...init, redirect: 'manual', credentials: 'omit', signal: controller.signal });
    upstreamStatus = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new XConnectionError(`${label} 중 예상하지 않은 주소 이동 응답을 받았습니다. 잠시 후 다시 연결해 주세요.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new XConnectionError('X API 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.', 429);
      if (response.status === 402 || response.status === 403) throw new XConnectionError('X 개발자 앱의 API 이용 권한과 잔액을 확인해야 합니다.', 403);
      if (response.status === 401 || response.status === 400) throw new XConnectionError('X 연결을 확인하지 못했습니다. 계정을 다시 연결해 주세요.', 401);
      throw new XConnectionError('X가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.');
    }
    // 한 페이지는 최대 1,000개다. 비정상 응답을 계속 받지 않는다.
    const text = await response.text();
    if (text.length > 2_000_000) throw new XConnectionError('X 응답이 너무 큽니다.');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyntaxError('Unexpected X response');
    return data;
  } catch (error) {
    // 요청 내용·헤더·응답 본문에는 키와 토큰이 있으므로 기록하지 않고 실패 단계만 남긴다.
    console.warn('X API 요청 실패', { step, status: upstreamStatus, reason: controller.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'invalid_json' : error instanceof XConnectionError ? 'response' : 'network' });
    if (error instanceof XConnectionError) throw error;
    if (controller.signal.aborted) throw new XConnectionError(`${label} 응답이 늦어지고 있습니다. 잠시 후 다시 연결해 주세요.`);
    if (error instanceof SyntaxError) throw new XConnectionError(`${label} 중 X가 올바르지 않은 응답 형식을 보냈습니다. 잠시 후 다시 연결해 주세요.`);
    throw new XConnectionError(`${label} 중 X에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
  } finally { clearTimeout(timer); }
}

export const xRoutes = new Hono<{ Bindings: Env; Variables: { user: UserRecord } }>();
xRoutes.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
xRoutes.onError((error, c) => c.json({ error: error instanceof XConnectionError ? error.message : 'X 연결 중 오류가 발생했습니다.' }, error instanceof XConnectionError ? error.status : 502));

async function clientConfig(env: Env, user: UserRecord, requestUrl: string) {
  const credentials = await readXCredentials(env);
  return { configured: Boolean(credentials), clientId: credentials?.clientId || null, redirectUri: xCallbackUrl(requestUrl), canManage: canManageX(env, user) && !(env.X_CLIENT_ID?.trim() && env.X_CLIENT_SECRET?.trim()) };
}
xRoutes.get('/config', async (c) => c.json(await clientConfig(c.env, c.get('user'), c.req.url)));

xRoutes.put('/settings', async (c) => {
  if (!canManageX(c.env, c.get('user'))) throw new XConnectionError('X 연결 설정은 SFeed 운영자만 변경할 수 있습니다.', 403);
  // 환경 변수로 관리 중인 설치에서는 화면 설정으로 덮어쓰지 않는다.
  if (c.env.X_CLIENT_ID?.trim() && c.env.X_CLIENT_SECRET?.trim()) throw new XConnectionError('이 연결 정보는 서버에서 관리 중입니다.', 400);
  const input = await c.req.json<{ clientId?: unknown; clientSecret?: unknown }>().catch(() => null);
  if (!input) throw new XConnectionError('연결 정보를 입력해 주세요.', 400);
  try { await saveXCredentials(c.env, input); }
  catch (error) { throw new XConnectionError(error instanceof XSettingsError ? error.message : 'X 연결 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', error instanceof XSettingsError ? 400 : 503); }
  return c.json(await clientConfig(c.env, c.get('user'), c.req.url));
});

xRoutes.post('/connect', async (c) => {
  const credentials = await readXCredentials(c.env);
  if (!credentials) throw new XConnectionError('X 연결 설정을 먼저 완료해 주세요.', 503);
  const body = await c.req.json<{ code?: unknown; verifier?: unknown }>().catch(() => null);
  if (typeof body?.code !== 'string' || !body.code || body.code.length > 2048 || typeof body.verifier !== 'string' || !/^[a-zA-Z\d._~-]{43,128}$/.test(body.verifier)) throw new XConnectionError('X 연결 요청을 확인할 수 없습니다. 다시 연결해 주세요.', 400);
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: body.code, code_verifier: body.verifier, redirect_uri: xCallbackUrl(c.req.url) });
  const auth = btoa(`${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(credentials.clientSecret)}`);
  const result = await xJson('2/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (typeof result.access_token !== 'string' || result.access_token.length > 4096 || !Number.isFinite(Number(result.expires_in)) || Number(result.expires_in) <= 0) throw new XConnectionError('X 로그인 응답을 확인하지 못했습니다.');
  const scopes = typeof result.scope === 'string' ? result.scope.split(' ') : [];
  if (!['users.read', 'follows.read'].every((scope) => scopes.includes(scope))) throw new XConnectionError('팔로우 목록을 읽을 권한을 허용해 주세요.', 403);
  const me = await xJson('2/users/me', { headers: { Authorization: `Bearer ${result.access_token}` } });
  if (!/^\d{1,20}$/.test(me.data?.id || '') || typeof me.data?.username !== 'string') throw new XConnectionError('X 계정 정보를 확인하지 못했습니다.');
  const connection = await seal(c.env, { sub: c.get('user').id, xId: me.data.id, token: result.access_token, expires: Date.now() + Math.min(Number(result.expires_in), 7200) * 1000 });
  return c.json({ connection, username: me.data.username });
});

xRoutes.post('/following', async (c) => {
  const body = await c.req.json<{ connection?: unknown; cursor?: unknown }>().catch(() => null);
  if (body?.cursor != null && (typeof body.cursor !== 'string' || !/^[a-zA-Z\d_-]{1,2048}$/.test(body.cursor))) throw new XConnectionError('다음 팔로우 목록의 주소를 확인하지 못했습니다.', 400);
  const connection = await unseal(c.env, body?.connection, c.get('user').id);
  const query = new URLSearchParams({ max_results: '1000', 'user.fields': 'name,username,profile_image_url,protected' });
  if (body?.cursor) query.set('pagination_token', body.cursor as string);
  const result = await xJson(`2/users/${connection.xId}/following?${query}`, { headers: { Authorization: `Bearer ${connection.token}` } });
  if (result.errors?.length || (result.data != null && !Array.isArray(result.data))) throw new XConnectionError('X 팔로우 목록의 일부를 읽지 못했습니다. 다시 시도해 주세요.');
  const accounts: XAccount[] = (result.data || []).flatMap((account: Record<string, unknown>) => {
    if (typeof account.id !== 'string' || !/^\d{1,20}$/.test(account.id) || typeof account.username !== 'string' || !xProfile(`@${account.username}`)) return [];
    const image = typeof account.profile_image_url === 'string' && /^https:\/\/pbs\.twimg\.com\//i.test(account.profile_image_url) ? account.profile_image_url : null;
    return [{ id: account.id, username: account.username, name: typeof account.name === 'string' ? account.name : account.username, protected: account.protected === true, profileImageUrl: image }];
  });
  if (accounts.length !== (result.data || []).length) throw new XConnectionError('X 계정 정보의 일부를 확인하지 못했습니다. 다시 불러와 주세요.');
  const nextCursor = typeof result.meta?.next_token === 'string' ? result.meta.next_token : null;
  return c.json({ accounts, nextCursor });
});
