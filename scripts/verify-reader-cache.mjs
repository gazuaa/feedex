import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
try {
  const { ReaderCache, revalidate, articlePageKey, CACHE_LIMITS, updateCounts, updateSubscription } = await vite.ssrLoadModule('/src/client/readerCache.ts');
  const rows = new Map(), storage = {
    async read(account, key) { return structuredClone(rows.get(JSON.stringify([account, key]))); },
    async write(snapshot) { rows.set(JSON.stringify([snapshot.account, snapshot.key]), structuredClone(snapshot)); },
    async remove(account) { for (const [key, row] of rows) if (row.account === account) rows.delete(key); },
  };
  let now = Date.now();
  const article = { id: 'one', feed_id: 'feed', title: 'Cached article', published_at: new Date(now - 3600_000).toISOString(), is_read: false, is_saved: false };
  const counts = { totalUnread: 2, totalArticles: 5, savedCount: 0, todayCount: 1, todayTotal: 2 };
  const sub = { feed_id: 'feed', unread_count: 2, total_count: 5, saved_count: 0 };
  const bootstrap = { folders: [], subscriptions: [sub], curatedFeeds: [], counts };
  const allKey = articlePageKey(new URLSearchParams('scope=all&unreadOnly=false'));
  assert.equal(allKey, articlePageKey(new URLSearchParams('unreadOnly=false&scope=all')));
  const cache = new ReaderCache('alice', storage, () => now);
  cache.put('bootstrap', bootstrap); cache.put(allKey, { articles: [article], hasMore: false }); await cache.flushed();
  const bob = new ReaderCache('bob', storage, () => now);
  assert.equal(await bob.get(allKey), undefined, 'another account never reads this snapshot');
  bob.put(allKey, { articles: [{ ...article, title: 'Bob' }] }); await bob.flushed();
  const reload = new ReaderCache('alice', storage, () => now);
  assert.equal((await reload.get(allKey)).articles[0].title, 'Cached article', 'device data survives an app restart');
  const network = deferred(), painted = deferred(), shown = [];
  const load = revalidate(reload, allKey, () => network.promise, (value) => { shown.push(value.articles[0].title); painted.resolve(); }, () => true);
  await painted.promise;
  assert.deepEqual(shown, ['Cached article'], 'the cached screen paints before the network responds');
  network.resolve({ articles: [{ ...article, title: 'Fresh article' }], hasMore: true }); await load;
  assert.deepEqual(shown, ['Cached article', 'Fresh article']);

  const disk = deferred(), slowDisk = new ReaderCache('alice', { ...storage, read: () => disk.promise }, () => now);
  const freshPainted = deferred();
  const latest = [], racing = revalidate(slowDisk, allKey, async () => ({ articles: [{ ...article, title: 'New' }] }), (data) => { latest.push(data.articles[0].title); freshPainted.resolve(); }, () => true);
  await freshPainted.promise;
  disk.resolve({ account: 'alice', key: allKey, savedAt: now, size: 100, data: { articles: [article] } }); await racing;
  assert.deepEqual(latest, ['New'], 'a late disk read never replaces a fresh response');
  assert.equal((await slowDisk.get(allKey)).articles[0].title, 'New', 'the in-memory cache also retains the newer network value');

  const unreadKey = articlePageKey(new URLSearchParams('scope=all&unreadOnly=true'));
  const savedKey = articlePageKey(new URLSearchParams('scope=saved'));
  cache.put(unreadKey, { articles: [article] }); cache.put(savedKey, { articles: [{ ...article, is_saved: true }] });
  const readSaved = { ...article, is_read: true, is_saved: true };
  cache.updateArticle(article, readSaved);
  assert.equal((await cache.get(unreadKey)).articles.length, 0);
  assert.equal((await cache.get(allKey)).articles[0].is_saved, true);
  assert.deepEqual((await cache.get('bootstrap')).counts, { ...counts, totalUnread: 1, todayCount: 0, savedCount: 1 });
  assert.equal((await cache.get('bootstrap')).subscriptions[0].saved_count, 1);
  cache.updateArticle(readSaved, { ...readSaved, is_saved: false });
  assert.equal((await cache.get(savedKey)).articles.length, 0, 'unsaving also updates stored saved lists');
  cache.updateFields(article.id, { full_content_html: '<p>Cached full body</p>' }); await cache.flushed();
  assert.equal((await new ReaderCache('alice', storage, () => now).get(allKey)).articles[0].full_content_html, '<p>Cached full body</p>');
  const old = { ...article, published_at: new Date(now - 60 * 86400_000).toISOString(), is_read: true };
  assert.equal(updateCounts(counts, old, { ...old, is_read: false }, now).totalUnread, 2);
  assert.equal(updateSubscription(sub, old, { ...old, is_read: false }, now).unread_count, 2);

  const stale = deferred(), ignored = [];
  const pending = revalidate(cache, allKey, () => stale.promise, (data) => ignored.push(data), () => true);
  await Promise.resolve(); await Promise.resolve();
  cache.updateArticle(readSaved, article); const beforeResponse = ignored.length;
  stale.resolve({ articles: [readSaved] }); await pending;
  assert.equal(ignored.length, beforeResponse, 'an earlier GET cannot overwrite optimistic state');
  const leaving = deferred(), afterLogout = [];
  const oldRequest = revalidate(cache, allKey, () => leaving.promise, (data) => afterLogout.push(data), () => true);
  cache.updateFields(article.id, { title: 'Retained at logout' });
  await cache.close(); const visibleAtLogout = afterLogout.length;
  assert.equal(cache.active, false);
  cache.put(allKey, { articles: [article] });
  cache.invalidate();
  leaving.resolve({ articles: [article] }); await oldRequest;
  assert.equal(afterLogout.length, visibleAtLogout);
  assert.equal(await cache.get(allKey), undefined);
  const returning = new ReaderCache('alice', storage, () => now);
  const retained = (await returning.get(allKey)).articles[0];
  assert.equal(retained.title, 'Retained at logout', 'writes queued before logout finish and survive same-account login');
  assert.equal(retained.full_content_html, '<p>Cached full body</p>');
  assert.deepEqual((await returning.get('bootstrap')).counts, counts);
  assert.equal((await bob.get(allKey)).articles[0].title, 'Bob', 'retained data stays isolated from another account');
  await returning.clear();
  assert.ok([...rows.values()].every((row) => row.account !== 'alice'));
  assert.equal((await bob.get(allKey)).articles[0].title, 'Bob', 'explicit deletion affects only its own account');

  now += CACHE_LIMITS.age + 1;
  assert.equal(await new ReaderCache('bob', storage, () => now).get(allKey), undefined, 'old device data expires');
  const noDisk = new ReaderCache('offline-storage', { read: async () => { throw Error('blocked'); }, write: async () => { throw Error('quota'); }, remove: async () => {} });
  const online = [];
  await revalidate(noDisk, allKey, async () => ({ articles: [article] }), (data) => online.push(data), () => true);
  await noDisk.flushed(); assert.equal(online.length, 1); assert.equal((await noDisk.get(allKey)).articles.length, 1);
  const large = new ReaderCache('large', storage);
  large.put(allKey, { articles: Array.from({ length: 32 }, () => ({ ...article, content_html: 'a'.repeat(200_000) })) });
  await large.flushed();
  const bounded = await large.get(allKey);
  assert.ok(bounded.articles.length < 32); assert.equal(bounded.hasMore, true);
  assert.ok([...rows.values()].filter((row) => row.account === 'large').every((row) => row.size <= CACHE_LIMITS.bytes));

  const { ReaderPreloader, preloadArticleQueries, feedCacheVersion } = await vite.ssrLoadModule('/src/client/readerPreload.ts');
  const allQuery = new URLSearchParams('scope=all&unreadOnly=false');
  const plan = preloadArticleQueries(allQuery);
  assert.deepEqual(plan.map((query) => query.get('scope')), ['all', 'saved']);
  const folderPlan = preloadArticleQueries(new URLSearchParams('scope=folder&folderId=folder-one&unreadOnly=true'));
  assert.equal(folderPlan.length, 5, 'only library tabs and the selected folder are warmed');
  assert.equal(folderPlan.filter((query) => query.get('folderId') === 'folder-one').length, 2);
  assert.deepEqual(folderPlan.slice(0, 2).map((query) => query.get('folderId')), ['folder-one', 'folder-one'], 'the open folder\'s other tabs are warmed before the library');
  const { filteredPage, sameListOtherTab } = await vite.ssrLoadModule('/src/client/syncPages.ts');
  assert.ok(sameListOtherTab('scope=feed&feedId=f&unreadOnly=false', new URLSearchParams('scope=feed&feedId=f&unreadOnly=true')));
  assert.ok(sameListOtherTab('scope=feed&feedId=f&unreadOnly=false', new URLSearchParams('scope=feed&feedId=f&unreadOnly=false&savedOnly=true')));
  assert.ok(!sameListOtherTab('scope=feed&feedId=f&unreadOnly=false', new URLSearchParams('scope=feed&feedId=g&unreadOnly=true')), 'another feed is not drawn from this one');
  assert.ok(!sameListOtherTab('', new URLSearchParams('scope=feed&feedId=f&unreadOnly=true')));
  const pool = [['n1', 'f', false, false, 1], ['n2', 'f', true, true, 2], ['n3', 'f', false, true, 3], ['other', 'g', false, false, 4]].map(([id, feed_id, is_read, is_saved, hour]) => ({ ...article, id, feed_id, is_read, is_saved, published_at: new Date(now - hour * 3600_000).toISOString() }));
  assert.deepEqual(filteredPage(new URLSearchParams('scope=feed&feedId=f&unreadOnly=true'), pool, now).map((row) => row.id), ['n1', 'n3'], 'unread tab keeps only this feed\'s unread posts, newest first');
  assert.deepEqual(filteredPage(new URLSearchParams('scope=feed&feedId=f&unreadOnly=false&savedOnly=true&sort=oldest'), pool, now).map((row) => row.id), ['n3', 'n2']);
  assert.equal(preloadArticleQueries(new URLSearchParams('scope=all&search=bitcoin')).length, 0, 'search does not trigger speculative downloads');
  const folderWarm = preloadArticleQueries(new URLSearchParams('scope=all&unreadOnly=true&sort=oldest'), ['folder-one', 'folder-two']);
  assert.deepEqual(folderWarm.filter((query) => query.get('scope') === 'folder').map((query) => `${query.get('folderId')}:${query.get('unreadOnly')}:${query.get('sort')}`), ['folder-one:true:oldest', 'folder-two:true:oldest'], 'every folder is warmed under the filter in use');
  const insideFolder = preloadArticleQueries(new URLSearchParams('scope=folder&folderId=folder-one&unreadOnly=false'), ['folder-one', 'folder-two']).map((query) => articlePageKey(query));
  assert.equal(new Set(insideFolder).size, insideFolder.length, 'the selected folder is not downloaded twice');
  assert.ok(!insideFolder.includes(articlePageKey(new URLSearchParams('scope=folder&folderId=folder-one&unreadOnly=false'))));
  assert.equal(feedCacheVersion(bootstrap), feedCacheVersion({ ...bootstrap, subscriptions: [{ ...sub, unread_count: 0, saved_count: 1 }] }), 'read/save counts do not refetch the library');
  const updated = { ...bootstrap, subscriptions: [{ ...sub, total_count: 6, last_fetched_at: 'updated' }] };
  assert.notEqual(feedCacheVersion(bootstrap), feedCacheVersion(updated), 'a new feed update invalidates the preload version');

  const warm = new ReaderCache('warm', storage), preloader = new ReaderPreloader(warm);
  const started = deferred(), firstPage = deferred();
  let requests = 0, concurrent = 0, maxConcurrent = 0, foregroundRequests = 0;
  const fetchPage = async (query) => {
    assert.equal(query.get('limit'), '20', 'speculation only downloads the first screen');
    requests++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    try {
      if (requests === 1) { started.resolve(); return await firstPage.promise; }
      return { articles: [{ ...article, title: 'Preloaded' }] };
    } finally { concurrent--; }
  };
  const warming = preloader.run(plan, 'v1', fetchPage, () => true);
  await started.promise;
  const foreground = [];
  const opening = revalidate(warm, articlePageKey(plan[0]), async () => { foregroundRequests++; return { articles: [] }; }, (data) => foreground.push(data), () => true);
  firstPage.resolve({ articles: [{ ...article, title: 'Shared request' }] });
  await Promise.all([warming, opening]);
  assert.equal(foregroundRequests, 0, 'opening a warming list shares the in-flight network request');
  assert.equal(foreground.at(-1).articles[0].title, 'Shared request');
  assert.equal(requests, 2); assert.equal(maxConcurrent, 1, 'background downloads run serially');
  await preloader.run(plan, 'v1', fetchPage, () => true);
  assert.equal(requests, 2, 'unchanged feeds do not download warmed lists again');
  await preloader.run(plan, 'v2', fetchPage, () => true);
  assert.equal(requests, 4, 'updated feeds refresh warmed lists');
  warm.invalidate();
  await preloader.run(plan, 'v2', fetchPage, () => true);
  assert.equal(requests, 6, 'explicit invalidation is refilled even when the feed version is unchanged');
  await warm.flushed();
  assert.equal((await new ReaderCache('warm', storage).get(articlePageKey(plan[1]))).articles[0].title, 'Preloaded', 'preloaded pages persist for the next launch');

  const cancelled = new ReaderCache('cancelled-preload', storage), cancelledLoader = new ReaderPreloader(cancelled);
  const waiting = deferred(), inFlight = deferred(); let cancelledRequests = 0;
  const cancellation = cancelledLoader.run(plan, 'v1', async () => { cancelledRequests++; inFlight.resolve(); return waiting.promise; }, () => true);
  await inFlight.promise; await cancelled.close();
  waiting.resolve({ articles: [article] }); await cancellation;
  assert.equal(cancelledRequests, 1, 'logout stops the rest of the preload queue');
  assert.equal(await new ReaderCache('cancelled-preload', storage).get(articlePageKey(plan[0])), undefined, 'a late preload cannot write after logout');

  const mutated = new ReaderCache('mutated-preload', storage), mutationLoader = new ReaderPreloader(mutated);
  const stalePage = deferred(), fetching = deferred();
  const mutationLoad = mutationLoader.run(plan, 'v1', async () => { fetching.resolve(); return stalePage.promise; }, () => true);
  await fetching.promise;
  mutated.put(articlePageKey(plan[0]), { articles: [article] });
  mutated.updateArticle(article, readSaved);
  stalePage.resolve({ articles: [article] }); await mutationLoad;
  assert.equal((await mutated.get(articlePageKey(plan[0]))).articles.length, 0, 'an in-flight preload cannot restore an optimistically read article to unread');

  const resilient = new ReaderCache('resilient-preload', storage), resilientLoader = new ReaderPreloader(resilient);
  let failedRequests = 0;
  await resilientLoader.run(plan, 'v1', async () => { if (++failedRequests === 1) throw Error('offline'); return { articles: [article] }; }, () => true);
  assert.ok(await resilient.get(articlePageKey(plan[1])), 'one failed preload does not block another list');
  await resilientLoader.run(plan, 'v1', async () => { failedRequests++; return { articles: [article] }; }, () => true);
  assert.equal(failedRequests, 3, 'a failed preload can be retried');
  const { ReaderSync } = await vite.ssrLoadModule('/src/client/readerSync.ts');
  const instant = new ReaderCache('instant', storage), instantSync = new ReaderSync(instant, async () => { throw Error('offline'); });
  const folderQuery = new URLSearchParams('scope=folder&folderId=folder-one&unreadOnly=false');
  assert.equal(instantSync.ready(folderQuery), undefined);
  instant.put('bootstrap', { ...bootstrap, cacheEpoch: 'synced' });
  instant.put(articlePageKey(folderQuery), { articles: [article], syncEpoch: 'synced' });
  assert.equal(instantSync.ready(folderQuery).articles.length, 1, 'a warmed folder paints without waiting for storage or the network');
  instant.put(articlePageKey(folderQuery), { articles: [article], syncEpoch: 'earlier' });
  assert.equal(instantSync.ready(folderQuery), undefined, 'a list saved before the last sync is checked first');
  for (let i = 0; i <= CACHE_LIMITS.entries; i++) instant.put(articlePageKey(new URLSearchParams(`scope=feed&feedId=many-${i}&unreadOnly=false`)), { articles: [] });
  assert.equal(instant.epoch, 'synced', 'many saved lists never push the sync epoch out of memory');
  console.log('PASS: cached paint/reload, logout retention, account isolation, stale response protection, optimistic state, cache limits, bounded serial preloading, folder warming, instant ready lists, shared foreground requests, feed-update refresh, cancellation and retry.');
} finally { await vite.close(); }
