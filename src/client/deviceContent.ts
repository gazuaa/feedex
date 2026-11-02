import type { ArticleItem } from './api';
import { openDeviceDatabase } from './deviceDatabase';
import { cacheGeneration, CONTENT_LIMIT, estimateBytes, retentionAge, SNAPSHOT_LIMITS } from './cachePolicy';

export interface ContentEntry { account: string; key: string; data: Partial<ArticleItem> | { html: string; url: string; phone?: boolean }; savedAt: number; size: number }
const memory = new Map<string, ContentEntry>();
const pending = new Set<Promise<unknown>>();
// 정리는 계정의 모든 키를 훑으므로, 쓸 때마다가 아니라 주기적으로 돌린다.
const SWEEP_EVERY = 50;
let writes = 0;
const id = (account: string, key: string) => `${account}:${key}`;
export async function readContent(account: string, key: string): Promise<ContentEntry | undefined> {
  const generation = cacheGeneration.get(account);
  const cached = memory.get(id(account, key));
  if (cached && cached.savedAt + retentionAge(account) > Date.now()) return cached;
  const db = await openDeviceDatabase(); if (!db) return;
  const row = await new Promise<ContentEntry | undefined>((resolve) => {
    try { const req = db.transaction('content').objectStore('content').get([account, key]); req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(undefined); } catch { resolve(undefined); }
  });
  if (generation !== cacheGeneration.get(account)) return;
  const newer = memory.get(id(account, key));
  if (newer && newer.savedAt + retentionAge(account) > Date.now()) return newer;
  if (row?.account === account && row.savedAt + retentionAge(account) > Date.now()) { remember(row); return row; }
}
function remember(row: ContentEntry) {
  memory.delete(id(row.account, row.key)); memory.set(id(row.account, row.key), row);
  let bytes = [...memory.values()].reduce((sum, item) => sum + item.size, 0);
  for (const [key, item] of memory) { if (bytes <= 16 * 1024 * 1024) break; memory.delete(key); bytes -= item.size; }
}
export function writeContent(account: string, key: string, data: ContentEntry['data']) {
  const generation = cacheGeneration.get(account), row = { account, key, data, savedAt: Date.now(), size: estimateBytes(data) };
  if (row.size > 4 * 1024 * 1024) return Promise.resolve();
  remember(row);
  const work = openDeviceDatabase().then(async (db) => {
    if (!db || generation !== cacheGeneration.get(account)) return;
    await new Promise<void>((resolve) => { try {
      const tx = db.transaction('content', 'readwrite'); tx.oncomplete = tx.onabort = tx.onerror = () => resolve();
      tx.objectStore('content').put(row);
    } catch { resolve(); } });
  }).catch(() => {}).finally(() => { pending.delete(work); if (++writes % SWEEP_EVERY === 0) void maintainDeviceCache(account); });
  pending.add(work); return work;
}
export function rememberArticles(account: string, articles: ArticleItem[]) {
  for (const article of articles) if (!article.body_deferred && (article.content_html || article.full_content_html)) {
    const previous = memory.get(id(account, `article:${article.id}`));
    const before = previous?.data as Partial<ArticleItem> | undefined;
    if (previous && previous.savedAt + retentionAge(account) > Date.now() && before?.content_html === article.content_html && (!article.full_content_html || before?.full_content_html === article.full_content_html) && before?.url === article.url) continue;
    const generation = cacheGeneration.get(account);
    void cachedArticle(account, article).then((body) => {
      if (generation !== cacheGeneration.get(account)) return;
      // 피드 본문만 있는 목록이 나중에 와도 리더 전체 HTML은 지킨다.
      return writeContent(account, `article:${article.id}`, { id: article.id, url: article.url, content_html: body.content_html, full_content_html: body.full_content_html, ai_summary: body.ai_summary, published_at: body.published_at, date_source: body.date_source });
    });
  }
}
export async function cachedArticle(account: string, article: ArticleItem): Promise<ArticleItem> {
  const data = (await readContent(account, `article:${article.id}`))?.data as Partial<ArticleItem> | undefined;
  if (!data || data.url !== article.url) return article;
  return { ...article, content_html: article.content_html || data.content_html || null, full_content_html: article.full_content_html || data.full_content_html || null,
    ai_summary: article.ai_summary || data.ai_summary || null, ...(data.date_source === 'original' ? { date_source: data.date_source, published_at: data.published_at! } : {}), body_deferred: article.body_deferred && !data.content_html && !data.full_content_html };
}
export async function maintainDeviceCache(account: string, clear = false) {
  if (clear) { cacheGeneration.set(account, (cacheGeneration.get(account) || 0) + 1); for (const [key, row] of memory) if (row.account === account) memory.delete(key); }
  await Promise.allSettled([...pending]);
  const db = await openDeviceDatabase(); if (!db) return { bytes: 0, entries: 0 };
  return new Promise<{ bytes: number; entries: number }>((resolve) => { try {
    const tx = db.transaction(['snapshots', 'content'], 'readwrite');
    let bytes = 0, entries = 0;
    tx.oncomplete = () => resolve({ bytes, entries }); tx.onabort = tx.onerror = () => resolve({ bytes, entries });
    for (const name of ['snapshots', 'content']) {
      const store = tx.objectStore(name), rows: { key: IDBValidKey; at: number; size: number }[] = [];
      const cursor = store.index('age-size').openKeyCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (item) {
          const [at, size] = item.key as number[], owner = String((item.primaryKey as string[])[0]);
          if (owner === account) rows.push({ key: item.primaryKey, at, size });
          item.continue(); return;
        }
        let total = rows.reduce((sum, row) => sum + row.size, 0);
        for (const row of rows) {
          if (clear || row.at + retentionAge(account) <= Date.now() || total > (name === 'content' ? CONTENT_LIMIT : SNAPSHOT_LIMITS.bytes)) { store.delete(row.key); total -= row.size; }
          else { bytes += row.size; entries++; }
        }
      };
    }
  } catch { resolve({ bytes: 0, entries: 0 }); } });
}
