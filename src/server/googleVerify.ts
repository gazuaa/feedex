// Google ID 토큰 RS256 검증 (MUUSED src/user-data.js에서 옮겨 옴)
// Google Identity Services(GIS) JWT credential을 Google 공개 JWK 인증서로 검증한다

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// FeedEx Google Cloud 프로젝트의 "FeedEx Web" OAuth 클라이언트
export const DEFAULT_GOOGLE_CLIENT_ID =
  '649668487161-f4hutlff1sc7klvplnrm3dki5u3oh3ht.apps.googleusercontent.com';

const DEFAULT_AUDIENCES = new Set([DEFAULT_GOOGLE_CLIENT_ID]);

const enc = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  let normalized = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64uToText = (s: string) => new TextDecoder().decode(b64uToBytes(s));

let certCache: { keys: JsonWebKey[] | null; expiresAt: number } = {
  keys: null,
  expiresAt: 0,
};

async function googleKeys(): Promise<Array<JsonWebKey & { kid?: string }>> {
  if (certCache.keys && certCache.expiresAt > Date.now()) {
    return certCache.keys as Array<JsonWebKey & { kid?: string }>;
  }
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('구글 공개키를 받지 못했습니다');
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const cc = res.headers.get('cache-control') || '';
  const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1] || 3600);
  certCache = {
    keys: body.keys || [],
    expiresAt: Date.now() + Math.min(maxAge, 86400) * 1000,
  };
  return certCache.keys as Array<JsonWebKey & { kid?: string }>;
}

export interface GoogleTokenPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  iat?: number;
}

export async function verifyGoogleToken(
  token: string,
  extraClientId?: string
): Promise<GoogleTokenPayload | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  let header: { alg?: string; kid?: string };
  let payload: GoogleTokenPayload;
  try {
    header = JSON.parse(b64uToText(parts[0]));
    payload = JSON.parse(b64uToText(parts[1]));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;
  if (!ISSUERS.has(payload.iss)) return null;

  const allowedAudiences = new Set(DEFAULT_AUDIENCES);
  if (extraClientId) allowedAudiences.add(extraClientId);
  if (!allowedAudiences.has(payload.aud)) return null;
  if (!payload.sub) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + 60 < now) return null;
  if (typeof payload.iat === 'number' && payload.iat - 60 > now) return null;

  const keys = await googleKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64uToBytes(parts[2]) as BufferSource,
    enc.encode(`${parts[0]}.${parts[1]}`)
  );

  return ok ? payload : null;
}
