import type { Env, WorkersAILike } from './types';

type Service = 'deepl' | 'workers-ai';
export type PersonalAI = { accountId: string; token: string };
const ready = new WeakSet<Env['DB']>();
const table = `CREATE TABLE IF NOT EXISTS user_article_tool_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK(service IN ('deepl','workers-ai')),
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (user_id, service)
)`;
const resultsTable = `CREATE TABLE IF NOT EXISTS user_article_tool_results (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id, variant)
)`;

export const personalToolStorage = (env: Env) => Boolean(env.X_SETTINGS_SECRET && env.X_SETTINGS_SECRET.length >= 32);

async function ensureTable(db: Env['DB']) {
  if (ready.has(db)) return;
  await db.batch([db.prepare(table), db.prepare(resultsTable)]);
  ready.add(db);
}

export async function readPersonalToolResult<T>(db: Env['DB'], userId: string, articleId: string, variant: string): Promise<T | null> {
  await ensureTable(db);
  const row = await db.prepare('SELECT result_json FROM user_article_tool_results WHERE user_id=? AND article_id=? AND variant=?')
    .bind(userId, articleId, variant).first<{ result_json: string }>();
  return row ? JSON.parse(row.result_json) as T : null;
}

export async function savePersonalToolResult(db: Env['DB'], userId: string, articleId: string, variant: string, value: unknown) {
  await ensureTable(db);
  await db.prepare(`INSERT INTO user_article_tool_results(user_id,article_id,variant,result_json) VALUES(?,?,?,?)
    ON CONFLICT(user_id,article_id,variant) DO UPDATE SET result_json=excluded.result_json`)
    .bind(userId, articleId, variant, JSON.stringify(value)).run();
}

const enc = new TextEncoder();
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptionKey(env: Env) {
  const secret = env.X_SETTINGS_SECRET;
  if (!secret || !personalToolStorage(env)) throw new Error('서버에 개인 API 키를 저장할 준비가 되지 않았어요.');
  const bytes = await crypto.subtle.digest('SHA-256', enc.encode(`feedex:personal-article-tools:v1:${secret}`));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const associatedData = (userId: string, service: Service) => enc.encode(`${userId}:${service}`);

export async function savePersonalTool(env: Env, userId: string, service: Service, value: string | PersonalAI) {
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(userId, service) }, key, enc.encode(JSON.stringify(value)));
  await ensureTable(env.DB);
  await env.DB.prepare(`INSERT INTO user_article_tool_keys(user_id,service,encrypted_value) VALUES(?,?,?)
    ON CONFLICT(user_id,service) DO UPDATE SET encrypted_value=excluded.encrypted_value`)
    .bind(userId, service, `${encode(iv)}.${encode(new Uint8Array(encrypted))}`).run();
}

export async function clearPersonalTool(env: Env, userId: string, service: Service) {
  await ensureTable(env.DB);
  await env.DB.prepare('DELETE FROM user_article_tool_keys WHERE user_id=? AND service=?').bind(userId, service).run();
}

export function validPersonalAI(value: unknown): value is PersonalAI {
  if (!value || typeof value !== 'object' || !('accountId' in value) || !('token' in value)) return false;
  return typeof value.accountId === 'string' && /^[a-f\d]{32}$/i.test(value.accountId)
    && typeof value.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(value.token);
}

export async function readPersonalTools(env: Env, userId: string, onlyAI = false) {
  const settings: { deepl: string | null; ai: PersonalAI | null } = { deepl: null, ai: null };
  if (!personalToolStorage(env)) return settings;
  await ensureTable(env.DB);
  const { results } = await env.DB.prepare(`SELECT service,encrypted_value FROM user_article_tool_keys WHERE user_id=?${onlyAI ? " AND service='workers-ai'" : ''}`)
    .bind(userId).all<{ service: Service; encrypted_value: string }>();
  if (!results.length) return settings;
  const key = await encryptionKey(env);
  for (const row of results) {
    try {
      const [iv, ciphertext] = row.encrypted_value.split('.');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: associatedData(userId, row.service) }, key, decode(ciphertext));
      const value: unknown = JSON.parse(new TextDecoder().decode(plain));
      if (row.service === 'deepl' && typeof value === 'string') settings.deepl = value;
      if (row.service === 'workers-ai' && validPersonalAI(value)) settings.ai = value;
    } catch { /* 다른 계정에서 옮긴 값이나 열 수 없는 키는 사용하지 않는다. */ }
  }
  return settings;
}

export function personalWorkersAI(account: PersonalAI): WorkersAILike {
  return { async run(model, inputs) {
    if (!/^@cf\/[\w.-]+\/[\w.-]+$/.test(model)) throw new Error('사용할 수 없는 Workers AI 모델입니다.');
    const url = `https://api.cloudflare.com/client/v4/accounts/${account.accountId}/ai/run/${model}`;
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('개인 Workers AI 요청에 실패했어요.'); }
    const data = await response.json() as { success?: boolean; result?: Awaited<ReturnType<WorkersAILike['run']>> };
    if (data.success !== true || !data.result) throw new Error('개인 Workers AI 응답을 확인하지 못했어요.');
    return data.result;
  } };
}
