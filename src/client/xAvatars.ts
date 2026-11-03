import { useEffect, useState } from 'react';
import { apiRequest } from './api';

// 인용한 글·재게시한 글의 글쓴이 프로필 사진. 미러 RSS 글에는 이름만 있어서 따로 찾는다.
// 구독한 X 계정은 피드 아이콘이 곧 프로필 사진이고, 나머지는 서버가 한 번 찾아 기기에 일주일 남긴다.
const STORE = 'sfeed_x_avatars';
const KEEP = 7 * 86_400_000, RETRY = 10 * 60_000;
const known = new Map<string, { url: string | null; at: number }>();
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
let loaded = false, queued = new Set<string>(), timer = 0;

const key = (handle: string) => handle.toLowerCase();
function load() {
  if (loaded) return; loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') as Record<string, { url: string | null; at: number }>;
    for (const [handle, row] of Object.entries(saved)) if (row && Date.now() - row.at < KEEP && (row.url === null || /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(row.url))) known.set(handle, row);
  } catch { /* 저장소를 못 쓰면 이번 실행에서만 기억한다. */ }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries([...known].filter(([, row]) => Date.now() - row.at < KEEP).slice(-500)))); } catch { /* 저장소가 가득하면 다음에 다시 찾는다. */ }
}
const notify = () => listeners.forEach((listener) => listener());

/** 이미 아는 프로필 사진. 모르면 undefined다. */
export function xAvatarOf(handle: string | null | undefined): string | undefined {
  if (!handle) return undefined;
  load();
  return known.get(key(handle))?.url || undefined;
}

/** 구독한 X 계정의 프로필 사진을 미리 알려 둔다. */
export function rememberXAvatars(avatars: Iterable<[string, string]>) {
  load();
  let changed = false;
  for (const [handle, url] of avatars) if (known.get(key(handle))?.url !== url) { known.set(key(handle), { url, at: Date.now() }); changed = true; }
  if (changed) { save(); notify(); }
}

function request(handles: string[]) {
  load();
  for (const handle of handles.map(key)) {
    if (known.has(handle) || Date.now() - (asked.get(handle) || 0) < RETRY) continue;
    queued.add(handle);
  }
  if (!queued.size || timer) return;
  // 한 화면의 글들이 그려진 뒤 한 번에 묻는다.
  timer = window.setTimeout(async () => {
    timer = 0;
    const batch = [...queued].slice(0, 20); queued = new Set([...queued].slice(20));
    batch.forEach((handle) => asked.set(handle, Date.now()));
    try {
      const result = await apiRequest<{ avatars: Record<string, string | null>; more?: boolean }>('/api/x/avatars', { method: 'POST', body: JSON.stringify({ handles: batch }) });
      for (const [handle, url] of Object.entries(result.avatars || {})) known.set(key(handle), { url: url && /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(url) ? url : null, at: Date.now() });
      save(); notify();
      // 서버가 한 번에 받는 수를 넘겨 남긴 계정은 곧바로 다시 묻는다. 미러가 한도에 걸렸으면 나중에 묻는다.
      if (result.more) for (const handle of batch) if (!known.has(handle)) { asked.delete(handle); queued.add(handle); }
    } catch { /* 다음에 화면에 다시 나오면 묻는다. */ }
    if (queued.size) request([]);
  }, 300);
}

/** 목록에 나온 계정들의 프로필 사진을 찾고, 찾으면 다시 그린다. */
export function useXAvatars(handles: string[]): (handle: string | null | undefined) => string | undefined {
  const [, setVersion] = useState(0);
  const wanted = [...new Set(handles.filter(Boolean).map(key))].sort().join(',');
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  useEffect(() => { if (wanted) request(wanted.split(',')); }, [wanted]);
  return xAvatarOf;
}
