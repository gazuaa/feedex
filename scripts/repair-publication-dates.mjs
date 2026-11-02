// 미리 보기: --db remote|local. 백업 후 고치기: --apply를 덧붙인다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const dbMode = args[args.indexOf('--db') + 1];
if (!args.includes('--db') || !['local', 'remote'].includes(dbMode)) throw new Error('Use --db local|remote [--apply]');
const apply = args.includes('--apply');
const root = fileURLToPath(new URL('..', import.meta.url));
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const local = dbMode === 'local' ? new DatabaseSync(join(root, '.local/sfeed.sqlite')) : null;
const wrangler = join(root, 'node_modules/.bin/wrangler');
function remote(params) {
  const output = execFileSync(wrangler, ['d1', 'execute', 'sfeed', '--remote', '--json', ...params], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  // --file은 --json을 줘도 업로드 진행 상황을 출력한다. 이어지는 SELECT로 반영된 행을
  // 확인한다. 명령이 실패하면 이 지점 전에 이미 예외가 난다.
  return params.includes('--file') ? [] : JSON.parse(output);
}
const query = (sql) => local ? local.prepare(sql).all() : remote(['--command', sql]).flatMap((result) => result.results || []);
const predicate = [
  "instr(COALESCE(content_html, ''), 'txt-date') > 0",
  "instr(COALESCE(content_html, ''), 'post-date') > 0",
  "instr(COALESCE(content_html, ''), 'entry-date') > 0",
  "instr(COALESCE(content_html, ''), 'datePublished') > 0",
  "instr(COALESCE(content_html, ''), 'article:published_time') > 0",
  "instr(COALESCE(full_content_html, ''), 'datePublished') > 0",
  "instr(COALESCE(full_content_html, ''), 'article:published_time') > 0",
  "(instr(url, 'hankyung.com/article/') > 0 AND summary IS NOT NULL)",
  "(instr(url, 'blockmedia.co.kr/archives/') > 0 AND summary IS NOT NULL)",
].join(' OR ');
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { extractOriginalPublishedAt, extractSummaryPublishedAt } = await vite.ssrLoadModule('/src/server/publicationDate.ts');
  const rows = query('SELECT * FROM articles WHERE ' + predicate);
  const verified = new Set(query("SELECT article_id FROM article_date_checks WHERE source='original'").map((row) => row.article_id));
  const changes = rows.flatMap((row) => {
    if (verified.has(row.id)) return [];
    const date = extractOriginalPublishedAt(row.content_html, row.url) || extractOriginalPublishedAt(row.full_content_html, row.url) || extractSummaryPublishedAt(row.summary, row.title, row.url);
    return date && Date.parse(date) !== Date.parse(row.published_at) ? [{ before: row, publishedAt: date }] : [];
  });
  console.log(JSON.stringify({ database: dbMode, examined: rows.length, corrections: changes.length, apply }));
  if (args.includes('--report')) writeFileSync(args[args.indexOf('--report') + 1], JSON.stringify(changes, null, 2), { mode: 0o600 });
  if (apply && changes.length) {
    const states = [];
    const dateChecks = [];
    for (let offset = 0; offset < changes.length; offset += 80) {
      const ids = changes.slice(offset, offset + 80).map(({ before }) => quote(before.id)).join(',');
      states.push(...query('SELECT * FROM article_states WHERE article_id IN (' + ids + ') ORDER BY user_id, article_id'));
      dateChecks.push(...query('SELECT * FROM article_date_checks WHERE article_id IN (' + ids + ')'));
    }
    const directory = join(root, '.local/article-date-backups', new Date().toISOString().replaceAll(':', '-') + '-' + dbMode);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, 'backup.json'), JSON.stringify({ changes, states, dateChecks }, null, 2), { mode: 0o600 });
    const now = new Date().toISOString();
    const sql = changes.flatMap(({ before, publishedAt }) => [
      'UPDATE articles SET published_at = ' + quote(publishedAt) + ' WHERE id = ' + quote(before.id) + ' AND published_at = ' + quote(before.published_at) + ';',
      'INSERT INTO article_date_checks(article_id,source,checked_at) VALUES(' + quote(before.id) + ",'original'," + quote(now) + ') ON CONFLICT(article_id) DO UPDATE SET source=excluded.source,checked_at=excluded.checked_at;',
    ]).join('\n');
    const path = join(directory, 'repair.sql');
    writeFileSync(path, sql, { mode: 0o600 });
    if (local) local.exec(sql); else remote(['--file', path]);
    const afterStates = [];
    for (let offset = 0; offset < changes.length; offset += 80) {
      const chunk = changes.slice(offset, offset + 80);
      const ids = chunk.map(({ before }) => quote(before.id)).join(',');
      const after = new Map(query('SELECT * FROM articles WHERE id IN (' + ids + ')').map((row) => [row.id, row]));
      for (const { before, publishedAt } of chunk) assert.deepEqual({ ...after.get(before.id) }, { ...before, published_at: publishedAt }, 'Only the publication date may change');
      afterStates.push(...query('SELECT * FROM article_states WHERE article_id IN (' + ids + ') ORDER BY user_id, article_id'));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(afterStates)), JSON.parse(JSON.stringify(states)), 'Read and bookmark states must remain intact');
    console.log('Verified ' + changes.length + ' corrected dates; IDs, contents and user states preserved. Backup: ' + directory);
  }
} finally {
  local?.close();
  await vite.close();
}
