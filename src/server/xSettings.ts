import type { Env, UserRecord } from './types';

export interface XCredentials { clientId: string; clientSecret: string }
export class XSettingsError extends Error {}
export const canManageX = (env: Env, user: UserRecord) => Boolean(env.OWNER_EMAIL?.trim() && env.OWNER_EMAIL.trim().toLowerCase() === user.email.toLowerCase());
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (value) => value.charCodeAt(0));
const valid = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{8,2048}$/.test(value);

async function settingsKey(env: Env) {
  if (!env.X_SETTINGS_SECRET || env.X_SETTINGS_SECRET.length < 32) throw new XSettingsError('X 연결 정보 저장 준비가 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`sfeed-x-settings-v1:${env.X_SETTINGS_SECRET}`));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function readXCredentials(env: Env): Promise<XCredentials | null> {
  if (env.X_CLIENT_ID?.trim() && env.X_CLIENT_SECRET?.trim()) return { clientId: env.X_CLIENT_ID.trim(), clientSecret: env.X_CLIENT_SECRET.trim() };
  if (!env.X_SETTINGS_SECRET) return null;
  const row = await env.DB.prepare("SELECT encrypted_value FROM integration_settings WHERE name='x_oauth'").first<{ encrypted_value: string }>();
  if (!row) return null;
  try {
    const [iv, body] = row.encrypted_value.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode('x_oauth') }, await settingsKey(env), decode(body));
    const value = JSON.parse(new TextDecoder().decode(plain));
    if (!valid(value.clientId) || !valid(value.clientSecret)) throw new Error();
    return value;
  } catch { throw new Error('저장된 X 연결 정보를 확인하지 못했습니다. 연결 설정을 다시 저장해 주세요.'); }
}

export async function saveXCredentials(env: Env, input: { clientId?: unknown; clientSecret?: unknown }): Promise<XCredentials> {
  const value = { clientId: typeof input.clientId === 'string' ? input.clientId.trim() : input.clientId, clientSecret: typeof input.clientSecret === 'string' ? input.clientSecret.trim() : input.clientSecret };
  if (!valid(value.clientId) || !valid(value.clientSecret)) throw new XSettingsError('X 앱의 Client ID와 Client Secret을 확인해 주세요.');
  // 앱 운영자의 연결 정보만 암호화해 보관한다. 암호화 키는 DB와 별도의 서버 비밀값이다.
  const credentials = value as XCredentials, iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('x_oauth') }, await settingsKey(env), new TextEncoder().encode(JSON.stringify(credentials)));
  await env.DB.prepare("INSERT INTO integration_settings(name,encrypted_value,updated_at) VALUES('x_oauth',?,?) ON CONFLICT(name) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at")
    .bind(`${encode(iv)}.${encode(new Uint8Array(encrypted))}`, new Date().toISOString()).run();
  return credentials;
}
