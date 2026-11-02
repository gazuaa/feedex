import type { OpmlFeed, OpmlImportResult } from '../shared/opml';
import type { D1DatabaseLike } from './types';
import { fetchAndParseFeed } from './rssParser';
import { generateId, upsertFeedAndArticles } from './seedService';

export class OpmlSourceError extends Error {
  constructor(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const status = message.match(/^HTTP (\d{3})$/)?.[1];
    let reason = '원본 피드 서버에 연결하거나 응답을 읽지 못했습니다.';
    if (status === '403') reason = '원본 사이트가 서버의 접근을 거부했습니다 (HTTP 403).';
    else if (status === '404' || status === '410') reason = `RSS 주소를 찾을 수 없습니다 (HTTP ${status}). 주소가 변경되었거나 폐쇄됐을 수 있습니다.`;
    else if (status === '429') reason = '원본 사이트의 요청 제한에 걸렸습니다 (HTTP 429). 잠시 후 다시 시도해 주세요.';
    else if (status) reason = `원본 사이트가 오류를 반환했습니다 (HTTP ${status}).`;
    else if (/ENOTFOUND|EAI_AGAIN|DNS|resolve/i.test(message) ||
      (error instanceof Error && /ENOTFOUND|EAI_AGAIN/.test(String((error.cause as { code?: string })?.code)))) {
      reason = 'RSS 도메인을 찾을 수 없습니다 (DNS 조회 실패). 주소 변경 또는 도메인 상태를 확인해 주세요.';
    }
    else if ((error instanceof Error && error.name === 'AbortError') || /abort|timed?\s*out/i.test(message)) {
      reason = '원본 사이트의 응답 시간이 7초를 초과했습니다.';
    } else if (message.includes('유효한 RSS 또는 Atom')) {
      reason = '해당 주소가 RSS 또는 Atom 피드 대신 다른 내용을 반환했습니다. RSS 주소를 확인해 주세요.';
    }
    super(reason, { cause: error });
    this.name = 'OpmlSourceError';
  }
}

export async function importOpmlFeed(
  db: D1DatabaseLike,
  userId: string,
  item: OpmlFeed
): Promise<OpmlImportResult> {
  const existing = await db.prepare(
    `SELECT s.id FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ? AND f.xml_url = ?`
  ).bind(userId, item.xmlUrl).first<{ id: string }>();
  if (existing) return { status: 'existing', foldersCreated: 0 };

  // 받기 실패는 그대로 알리고, 예시 글로 바꾸지 않는다.
  let parsed;
  try {
    parsed = await fetchAndParseFeed(item.xmlUrl);
  } catch (error) {
    throw new OpmlSourceError(error);
  }
  const { feedId } = await upsertFeedAndArticles(db, parsed);
  const canonicalSubscription = await db.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?'
  ).bind(userId, feedId).first<{ id: string }>();
  if (canonicalSubscription) return { status: 'existing', foldersCreated: 0 };

  const now = new Date().toISOString();
  let folderId: string | null = null;
  let foldersCreated = 0;
  if (item.folderName?.trim()) {
    const folderName = item.folderName.trim();
    let folder = await db.prepare(
      'SELECT id FROM folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
    ).bind(userId, folderName).first<{ id: string }>();
    if (!folder) {
      const proposedId = generateId('fld');
      await db.prepare(
        `INSERT OR IGNORE INTO folders (id, user_id, name, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(proposedId, userId, folderName, '#10b981', 10, now).run();
      folder = await db.prepare(
        'SELECT id FROM folders WHERE user_id = ? AND name = ? COLLATE NOCASE'
      ).bind(userId, folderName).first<{ id: string }>();
      if (!folder) throw new Error('폴더를 만들지 못했습니다.');
      if (folder.id === proposedId) foldersCreated++;
    }
    folderId = folder.id;
  }

  const subscription = await db.prepare(
    `INSERT INTO subscriptions (id, user_id, feed_id, folder_id, custom_title, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, feed_id) DO NOTHING RETURNING id`
  ).bind(generateId('sub'), userId, feedId, folderId, item.title?.trim() || null, now)
    .first<{ id: string }>();
  return { status: subscription ? 'imported' : 'existing', foldersCreated };
}
