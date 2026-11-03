// Feedly 공개 스트림 API에서 사용자의 피드 기록을 한 번 가져오는 스크립트.
//
// Feedly는 피드마다 몇 년 치 글을 보관하지만 RSS에는 최근 몇 개만 있다. 인증 없는
// 스트림 엔드포인트는 한 번에 최대 50개만 주고 이어받기 토큰도 없지만, `ranked=oldest`와
// `newerThan`(Feedly 수집 시각, ms)을 함께 쓰면 스트림을 첫 글부터 지금까지 따라갈 수 있다.
// 글은 originId == articles.guid로 FeedEx 행과 맞추므로 이미 있는 글은 건너뛴다.
//
//   npm run import:feedly -- download  --db remote --user <userId> [--feed <url part>]
//   npm run import:feedly -- write     --db remote --user <userId>
//
// `--db local`은 운영 D1 대신 .local/sfeed.sqlite에 쓴다. 받은 파일은
// .local/feedly-import/ 아래에 피드 주소별로 두고 두 데이터베이스가 함께 쓰며, 모든 단계는
// 멈춘 곳부터 이어서 한다. 읽음 상태는 쓰지 않는다. 앱이 30일보다 오래된 글을 이미 읽은
// 글로 다루기 때문이다.

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { acquireLock, createFeedlyClient, readEntries as readCompleteEntries, runFeedQueue, saveJson } from './feedly-import-support.mjs';

const DIR = '.local/feedly-import';
const LOCAL_DB = '.local/sfeed.sqlite';
const ROWS_PER_STATEMENT = 25; // INSERT 하나가 D1의 문장 크기 한도 100KB보다 넉넉히 작게 유지되도록 한다
const ROWS_PER_REMOTE_FILE = 4000;

const [command, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, '')] = rest[i + 1];
if (!['download', 'write'].includes(command) || !opts.user || !['local', 'remote'].includes(opts.db)) {
  console.error('usage: import-feedly-history.mjs <download|write> --db <local|remote> --user <userId> [--feed <url part>]');
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });

const sql = (value) => (value == null ? 'NULL' : `'${String(value).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const feedKey = (xmlUrl) => createHash('sha1').update(xmlUrl).digest('hex').slice(0, 16);
const statePath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.state.json`);
const dataPath = (xmlUrl) => join(DIR, `${feedKey(xmlUrl)}.jsonl`);
const readState = (xmlUrl) =>
  existsSync(statePath(xmlUrl)) ? JSON.parse(readFileSync(statePath(xmlUrl), 'utf8')) : { xmlUrl, cursor: null, done: false, count: 0, written: {} };
const saveState = (state) => saveJson(statePath(state.xmlUrl), state);
const readEntries = (xmlUrl) => readCompleteEntries(dataPath(xmlUrl));
const ratePath = join(DIR, 'rate-limit.json');
const fetchPage = createFeedlyClient({
  load: () => existsSync(ratePath) ? JSON.parse(readFileSync(ratePath, 'utf8')) : {},
  save: (state) => saveJson(ratePath, state),
  ...(opts['requests-per-day'] ? { requestBudget: Number(opts['requests-per-day']) } : {}),
});
const manifestPath = join(DIR, `${opts.db}.${feedKey(opts.user)}.feeds.json`);

function query(statement) {
  if (opts.db === 'local') {
    const db = new DatabaseSync(LOCAL_DB, { readOnly: true });
    try {
      return db.prepare(statement).all();
    } finally {
      db.close();
    }
  }
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'sfeed', '--remote', '--json', '--command', statement], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}

function execute(statements) {
  if (opts.db === 'local') {
    const db = new DatabaseSync(LOCAL_DB);
    try {
      db.exec('PRAGMA foreign_keys = ON');
      for (const statement of statements) db.exec(statement);
    } finally {
      db.close();
    }
    return;
  }
  const file = join(DIR, 'batch.sql');
  writeFileSync(file, statements.join('\n'));
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'sfeed', '--remote', '--file', file], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function subscribedFeeds() {
  const feeds = query(
    `SELECT f.id, f.xml_url, f.title FROM feeds f JOIN subscriptions s ON s.feed_id = f.id
     WHERE s.user_id = ${sql(opts.user)} ORDER BY f.title`
  );
  saveJson(manifestPath, feeds);
  return opts.feed ? feeds.filter((feed) => feed.xml_url.includes(opts.feed)) : feeds;
}

async function download(stripHtmlToSummary, decodeHtmlEntities, extractOriginalPublishedAt, extractSummaryPublishedAt) {
  const feeds = subscribedFeeds();
  console.log(`${feeds.length} subscribed feeds`);
  const schedulePath = join(DIR, `${opts.db}.${feedKey(opts.user)}.schedule.json`);
  const schedule = existsSync(schedulePath) ? JSON.parse(readFileSync(schedulePath, 'utf8')) : {};
  await runFeedQueue(feeds, {
    lastUrl: schedule.lastUrl,
    isDone: (feed) => readState(feed.xml_url).done,
    saveLast: (lastUrl) => saveJson(schedulePath, { lastUrl, updatedAt: new Date().toISOString() }),
    step: async (feed) => {
      const state = readState(feed.xml_url);
      state.title = feed.title;
      const existing = readCompleteEntries(dataPath(feed.xml_url), { repair: true });
      const seen = new Set(existing.map((entry) => entry.feedlyId));
      state.count = existing.length;
      console.log(`↓ ${feed.title}`);
      const page = await fetchPage(feed.xml_url, state.cursor);
      if (page.length === 0) {
        state.done = true;
        saveState(state);
        console.log(`✓ ${feed.title}: ${state.count} entries`);
        return;
      }
      const fresh = page.filter((entry) => !seen.has(entry.id));
      const lines = fresh.map((entry) => {
        seen.add(entry.id);
        const alternate = entry.alternate?.find((link) => link.href)?.href;
        const visual = entry.visual?.url;
        const url = alternate || entry.canonicalUrl || entry.originId;
        const title = decodeHtmlEntities(entry.title || '') || 'Untitled Article';
        const rawContent = entry.content?.content || entry.summary?.content || '';
        const summary = stripHtmlToSummary(entry.summary?.content || rawContent) || null;
        const originalPublishedAt = extractOriginalPublishedAt(rawContent, url) || extractSummaryPublishedAt(summary, title, url);
        return JSON.stringify({
          feedlyId: entry.id,
          guid: entry.originId || alternate || entry.id,
          url,
          title,
          author: entry.author || null,
          summary,
          thumbnailUrl: visual && /^https?:\/\//.test(visual) ? visual : null,
          publishedAt: originalPublishedAt || new Date(entry.published || entry.crawled).toISOString(),
          originalPublishedAt,
          dateSource: originalPublishedAt ? 'original' : entry.published ? 'feed' : 'collected',
        });
      });
      if (lines.length) appendFileSync(dataPath(feed.xml_url), lines.join('\n') + '\n');
      state.count += lines.length;

      // newerThan은 그 값을 포함하지 않으므로, 가장 최근 수집 시각보다 1ms 앞에서 다시 시작해
      // 같은 시각의 글을 놓치지 않는다. 새 글이 하나도 없는 페이지가 오면 그 시각을 넘긴다.
      const newest = Math.max(...page.map((entry) => entry.crawled || entry.published || 0));
      const next = fresh.length > 0 ? newest - 1 : newest;
      state.stalled = next <= (state.cursor ?? -1) ? (state.stalled || 0) + 1 : 0;
      state.cursor = Math.max(next, state.cursor ?? -1);
      saveState(state);
      if (state.stalled >= 3) {
        // 기록을 조용히 잃지 않도록, 덜 받은 피드는 덜 받았다고 보이게 둔다.
        throw new Error(`${feed.title}: cursor stopped advancing; saved progress retained`);
      }
      const last = page.reduce((a, b) => ((a.crawled || 0) > (b.crawled || 0) ? a : b));
      console.log(`  ${state.count} entries, now at ${new Date(last.crawled || last.published).toISOString().slice(0, 10)}`);
    },
  });
}

function write(extractSummaryPublishedAt) {
  const now = new Date().toISOString();
  if (existsSync(manifestPath)) {
    const cached = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const selected = opts.feed ? cached.filter((feed) => feed.xml_url.includes(opts.feed)) : cached;
    const pending = selected.some((feed) => {
      const state = readState(feed.xml_url);
      const path = join(DIR, `${feedKey(feed.xml_url)}.${opts.db}.written.json`);
      const offset = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).offset : state.written?.[opts.db] || 0;
      return (state.count || 0) > offset;
    });
    if (!pending) {
      console.log('All downloaded entries have already been published.');
      return;
    }
  }
  for (const feed of subscribedFeeds()) {
    const state = readState(feed.xml_url);
    // 기록하는 쪽은 체크포인트를 따로 가진다. 다운로드가 계속되며 자기 상태를 바꿔도
    // 이미 반영한 데이터베이스 위치가 되돌아가지 않는다.
    const progressPath = join(DIR, `${feedKey(feed.xml_url)}.${opts.db}.written.json`);
    const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, 'utf8')) : {};
    const entries = readEntries(feed.xml_url).slice(0, state.count);
    let offset = progress.offset ?? state.written?.[opts.db] ?? 0;
    if (offset >= entries.length) continue;
    console.log(`→ ${feed.title}: writing ${entries.length - offset} entries`);
    const fileRows = opts.db === 'remote' ? ROWS_PER_REMOTE_FILE : entries.length;
    while (offset < entries.length) {
      const slice = entries.slice(offset, offset + fileRows);
      // Feedly에는 링크가 아예 없는 오래된 글이 조금 있다. articles.url은 NOT NULL이라
      // 그런 행 하나 때문에 D1이 파일 전체를 거부한다.
      const chunk = slice.filter((entry) => entry.url);
      const statements = [];
      for (let i = 0; i < chunk.length; i += ROWS_PER_STATEMENT) {
        const values = chunk.slice(i, i + ROWS_PER_STATEMENT).map((entry) =>
          `(${[
            `art_${randomUUID()}`, feed.id, entry.guid, entry.title, entry.url, entry.author, entry.summary,
            null, entry.thumbnailUrl, entry.originalPublishedAt || extractSummaryPublishedAt(entry.summary, entry.title, entry.url) || entry.publishedAt, now,
          ].map(sql).join(', ')})`
        );
        statements.push(
          `INSERT INTO articles (id, feed_id, guid, title, url, author, summary, content_html, thumbnail_url, published_at, created_at)
           VALUES ${values.join(', ')} ON CONFLICT(feed_id, guid) DO NOTHING;`
        );
        const metadata = chunk.slice(i, i + ROWS_PER_STATEMENT).map((entry) => {
          const original = entry.originalPublishedAt || extractSummaryPublishedAt(entry.summary, entry.title, entry.url);
          return '(' + [entry.guid, original ? 'original' : entry.dateSource || 'feed', original ? now : null].map(sql).join(',') + ')';
        });
        statements.push(`WITH dates(guid,source,checked_at) AS (VALUES ${metadata.join(',')}) INSERT INTO article_date_checks(article_id,source,checked_at) SELECT a.id,d.source,d.checked_at FROM dates d JOIN articles a ON a.feed_id=${sql(feed.id)} AND a.guid=d.guid WHERE true ON CONFLICT(article_id) DO NOTHING;`);
      }
      if (statements.length) execute(statements);
      offset += slice.length;
      saveJson(progressPath, { offset, updatedAt: new Date().toISOString() });
      process.stdout.write(`  ${offset}/${entries.length}\r`);
    }
    console.log('');
  }
}

const release = acquireLock(DIR, command);
try {
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
  try {
    const { extractOriginalPublishedAt, extractSummaryPublishedAt } = await vite.ssrLoadModule('/src/server/publicationDate.ts');
    if (command === 'download') {
      const { stripHtmlToSummary, decodeHtmlEntities } = await vite.ssrLoadModule('/src/server/rssParser.ts');
      await download(stripHtmlToSummary, decodeHtmlEntities, extractOriginalPublishedAt, extractSummaryPublishedAt);
    } else {
      write(extractSummaryPublishedAt);
    }
  } finally {
    await vite.close();
  }
} finally {
  release();
}
