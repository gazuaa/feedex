import type { Lang } from '../shared/i18n';
import type { Env } from './types';

const ready = new WeakSet<Env['DB']>();

export async function ensureSummaryTable(db: Env['DB']) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS article_summaries (
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    summary TEXT NOT NULL,
    PRIMARY KEY (article_id, language)
  )`).run();
  ready.add(db);
}

export async function articleSummaryColumn(db: Env['DB'], language: Lang) {
  if (language === 'ko') return 'a.ai_summary';
  try {
    await ensureSummaryTable(db);
    return "(SELECT summary FROM article_summaries WHERE article_id=a.id AND language='en')";
  } catch { return 'NULL'; }
}
export async function articleSummary(db: Env['DB'], article: { id: string; ai_summary: string | null }, language: Lang) {
  if (language === 'ko') return article.ai_summary;
  await ensureSummaryTable(db);
  return (await db.prepare('SELECT summary FROM article_summaries WHERE article_id=? AND language=?')
    .bind(article.id, language).first<{ summary: string }>())?.summary ?? null;
}

export async function saveArticleSummary(db: Env['DB'], id: string, language: Lang, summary: string) {
  if (language === 'ko') return db.prepare('UPDATE articles SET ai_summary=? WHERE id=?').bind(summary, id).run();
  await ensureSummaryTable(db);
  return db.prepare(`INSERT INTO article_summaries(article_id, language, summary) VALUES(?,?,?)
    ON CONFLICT(article_id, language) DO UPDATE SET summary=excluded.summary`).bind(id, language, summary).run();
}
