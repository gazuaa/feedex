import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, LockKeyhole, RefreshCw, Users } from 'lucide-react';
import { apiRequest, type SubscriptionItem } from '../client/api';
import { consumeXCallback, xAuthorization, X_SETUP_LOGIN_URL, type XConfig } from '../client/xConnection';
import { importPause, importWithinLimits, useSecondsLeft } from '../client/importLimits';
import { XConnectionSetup } from './XConnectionSetup';
import { X_CALLBACK_QUERY, xProfile, type XAccount } from '../shared/xFeed';
import type { OpmlImportResult } from '../shared/opml';

interface Props { isDark: boolean; subscriptions: SubscriptionItem[]; onBusyChange: (busy: boolean) => void; onSubscribed: () => Promise<void> }
interface Report { processed: number; imported: number; existing: number; failures: { account: XAccount; error: string; saved: boolean }[] }

export function XFollowingImporter({ isDark, subscriptions, onBusyChange, onSubscribed }: Props) {
  const [config, setConfig] = useState<XConfig | null>(null);
  const [checking, setChecking] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [selected, setSelected] = useState(new Set<string>());
  const [imported, setImported] = useState(new Set<string>());
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(100);
  const [folder, setFolder] = useState('X');
  const [report, setReport] = useState<Report | null>(null);
  const [waiting, setWaiting] = useState<{ username: string; until: number } | null>(null);
  const secondsLeft = useSecondsLeft(waiting?.until ?? null);
  const pause = useRef(importPause());
  const started = useRef(false), working = useRef(false), stop = useRef(false), alive = useRef(true);
  const existing = new Set(subscriptions.map((item) => xProfile(item.xml_url)?.url).filter(Boolean));
  const subscribed = (account: XAccount) => imported.has(account.id) || existing.has(xProfile(`@${account.username}`)!.url);
  const surface = isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200';
  const input = `w-full rounded-xl border p-3 text-sm ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-300'}`;
  const changeBusy = (value: boolean) => { working.current = value; setBusy(value); onBusyChange(value); };

  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      void (async () => {
        try {
          const settings = await apiRequest<XConfig>('/api/x/config');
          if (!alive.current) return;
          setConfig(settings);
          const search = window.location.search;
          if (!new URLSearchParams(search).has(X_CALLBACK_QUERY)) return;
          const url = new URL(window.location.href);
          for (const key of [X_CALLBACK_QUERY, 'code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
          window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
          changeBusy(true);
          const payload = await consumeXCallback(search);
          if (!payload) return;
          const result = await apiRequest<{ connection: string; username: string }>('/api/x/connect', { method: 'POST', body: JSON.stringify(payload) });
          if (!alive.current) return;
          setConnection(result.connection); setUsername(result.username);
          await loadFollowing(result.connection);
        } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'X 연결에 실패했습니다.'); }
        finally { if (alive.current) { setChecking(false); changeBusy(false); } }
      })();
    }
    return () => { alive.current = false; stop.current = true; pause.current.cancel(); };
  }, []);

  useEffect(() => {
    if (!setupOpen) return;
    let lastCheck = 0;
    const check = () => {
      if (document.visibilityState === 'hidden' || Date.now() - lastCheck < 2000) return;
      lastCheck = Date.now();
      void apiRequest<XConfig>('/api/x/config').then((settings) => { if (alive.current) setConfig(settings); }).catch(() => {});
    };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [setupOpen]);

  async function checkConfig() {
    if (checking) return;
    setChecking(true); setError(null);
    try { setConfig(await apiRequest<XConfig>('/api/x/config')); }
    catch (err) { setError(err instanceof Error ? err.message : '연결 상태를 확인하지 못했습니다.'); }
    finally { setChecking(false); }
  }

  async function loadFollowing(sealed: string, from: string | null = null) {
    stop.current = false; setError(null);
    let next = from;
    const visited = new Set<string>(from ? [from] : []);
    do {
      const result = await apiRequest<{ accounts: XAccount[]; nextCursor: string | null }>('/api/x/following', { method: 'POST', body: JSON.stringify({ connection: sealed, cursor: next }) });
      if (!alive.current) return;
      setAccounts((current) => [...new Map([...current, ...result.accounts].map((account) => [account.id, account])).values()]);
      next = result.nextCursor; setCursor(next); setLoaded(true);
      if (next && visited.has(next)) throw new Error('X가 같은 목록을 반복해서 보냈습니다. 불러온 계정부터 선택해 주세요.');
      if (next) visited.add(next);
    } while (next && !stop.current);
  }

  async function connect(settings: XConfig) {
    if (working.current) return;
    changeBusy(true); setError(null);
    try { window.location.assign(await xAuthorization(settings)); }
    catch (err) { setError(err instanceof Error ? err.message : 'X 연결에 실패했습니다.'); changeBusy(false); }
  }

  async function more() {
    if (working.current || !connection || (loaded && !cursor)) return;
    changeBusy(true);
    try { await loadFollowing(connection, cursor); }
    catch (err) { setError(err instanceof Error ? err.message : '팔로우 목록을 가져오지 못했습니다.'); }
    finally { changeBusy(false); }
  }

  async function importSelected() {
    if (working.current) return;
    const queue = accounts.filter((account) => selected.has(account.id) && !account.protected && !subscribed(account));
    if (!queue.length) return;
    changeBusy(true); stop.current = false; setError(null);
    let current: Report = { processed: 0, imported: 0, existing: 0, failures: [] };
    setReport(current);
    try {
      for (const account of queue) {
        if (stop.current || !alive.current) break;
        const url = xProfile(`@${account.username}`)!.url;
        const item = { title: `${account.name} (@${account.username})`, xmlUrl: url, htmlUrl: url, folderName: folder.trim() || null };
        const { result, limited } = await importWithinLimits(async (): Promise<OpmlImportResult> => {
          try { return await apiRequest<OpmlImportResult>('/api/opml/import', { method: 'POST', body: JSON.stringify({ item }) }); }
          catch (err) { return { status: 'failed', foldersCreated: 0, error: err instanceof Error ? err.message : '가져오기에 실패했습니다.' }; }
        }, { pause: pause.current, stopped: () => stop.current || !alive.current, onWait: (until) => setWaiting(until ? { username: account.username, until } : null) });
        // 기다려도 한도가 풀리지 않으면 남은 계정도 같은 이유로 실패한다. 이 계정부터 선택한 채로 두고 멈춘다.
        if (limited) {
          if (!stop.current && alive.current) setError(`X 게시물 제공 경로의 요청 한도가 계속돼 @${account.username}에서 멈췄습니다. 남은 계정은 선택해 두었으니 잠시 뒤 다시 구독해 주세요.`);
          break;
        }
        let saved = result.failureSaved === true;
        if (result.status === 'failed' && !saved) {
          try { await apiRequest('/api/opml/failures', { method: 'POST', body: JSON.stringify({ item, error: result.error || '가져오기에 실패했습니다.' }) }); saved = true; } catch { /* 저장하지 못한 실패도 현재 화면에는 남긴다. */ }
        }
        current = { processed: current.processed + 1, imported: current.imported + Number(result.status === 'imported'), existing: current.existing + Number(result.status === 'existing'), failures: result.status === 'failed' ? [...current.failures, { account, error: result.error || '가져오기에 실패했습니다.', saved }] : current.failures };
        setReport(current);
        if (result.status !== 'failed') { setImported((value) => new Set(value).add(account.id)); setSelected((value) => { const next = new Set(value); next.delete(account.id); return next; }); }
      }
    } finally {
      try { await onSubscribed(); } catch { setError('구독은 처리됐지만 목록을 갱신하지 못했습니다. 새로고침해 주세요.'); }
      changeBusy(false);
    }
  }

  const shown = accounts.filter((account) => `${account.name} ${account.username}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const eligible = accounts.filter((account) => !account.protected && !subscribed(account));
  const selectedCount = eligible.filter((account) => selected.has(account.id)).length;
  return <section aria-label="X 팔로우 가져오기" className="space-y-4">
    <div className={`rounded-2xl border p-4 space-y-3 ${surface}`}>
      <h3 className="flex items-center gap-2 font-bold text-sm"><Users className="h-4 w-4" />내 X 팔로우 가져오기</h3>
      <p className="text-xs text-slate-400 leading-relaxed">X에 로그인해 팔로우 목록을 불러오고, 원하는 공개 계정을 골라 구독하세요. X의 팔로우 상태는 바뀌지 않습니다.</p>
      {config && !config.configured && <p role="status" className="text-xs text-slate-400">{config.canManage ? '처음 한 번 X 앱 연결이 필요합니다. 아래 버튼으로 로그인하고 설정을 마치세요.' : 'SFeed 운영자의 최초 X 연결 설정이 필요합니다.'}</p>}
      {config && !config.configured && config.canManage ? <a href={X_SETUP_LOGIN_URL} target="_blank" rel="noopener noreferrer" onClick={() => setSetupOpen(true)} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-slate-950 text-xs font-bold cursor-pointer inline-flex items-center gap-2"><Users className="w-4 h-4" />X 로그인 · 연결 설정<ExternalLink className="w-3.5 h-3.5" /></a> : <button type="button" onClick={() => { if (config?.configured) void connect(config); else void checkConfig(); }} disabled={busy || checking} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-40 inline-flex items-center gap-2">{busy || checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}{checking ? '연결 확인 중…' : !config?.configured ? '연결 상태 다시 확인' : connection ? 'X 계정 다시 연결' : 'X 계정 연결'}</button>}
      {config?.canManage && config.configured && <button type="button" disabled={busy} onClick={() => setSetupOpen((value) => !value)} className="ml-3 text-xs text-slate-400 underline cursor-pointer">연결 설정</button>}
      {username && <p className="text-xs text-emerald-500">@{username} 연결됨 · {accounts.length.toLocaleString()}개 계정 불러옴{busy && !report ? '…' : cursor ? ' · 남은 목록 있음' : ''}</p>}
    </div>
    {setupOpen && config?.canManage && <XConnectionSetup config={config} isDark={isDark} onBusyChange={changeBusy} onConfigured={(settings) => { setConfig(settings); setSetupOpen(false); void connect(settings); }} />}
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    {waiting && <p role="status" className="text-xs text-amber-500">X 게시물 제공 경로의 요청 한도에 걸려 잠시 기다립니다. {secondsLeft}초 뒤 @{waiting.username}부터 이어서 구독합니다.</p>}
    {busy && <button type="button" onClick={() => { stop.current = true; pause.current.cancel(); }} className="rounded-xl border border-slate-400/40 px-3 py-2 text-xs cursor-pointer">현재 요청 후 중단</button>}
    {!busy && connection && (cursor || !loaded) && <button type="button" onClick={more} className="inline-flex items-center gap-2 text-xs text-emerald-500 cursor-pointer"><RefreshCw className="w-4 h-4" />{loaded ? '남은 팔로우 목록 불러오기' : '팔로우 목록 다시 불러오기'}</button>}
    {accounts.length > 0 && <>
      <input aria-label="팔로우 계정 검색" placeholder="이름 또는 @아이디 검색" value={query} onChange={(event) => { setQuery(event.target.value); setVisible(100); }} className={input} />
      <div className="flex justify-between gap-3 text-xs"><span>{selectedCount}개 선택 · 비공개 계정은 가져올 수 없습니다.</span><button type="button" disabled={busy} className="text-emerald-500 cursor-pointer" onClick={() => setSelected(selectedCount === eligible.length ? new Set() : new Set(eligible.map((account) => account.id)))}>{selectedCount === eligible.length ? '선택 해제' : '전체 선택'}</button></div>
      <ul className={`rounded-2xl border divide-y max-h-80 overflow-y-auto ${isDark ? 'border-slate-800 divide-slate-800' : 'border-slate-200 divide-slate-200'}`}>{shown.slice(0, visible).map((account) => <li key={account.id} className="flex items-center gap-3 px-3 py-2.5">
        <label className="flex flex-1 min-w-0 items-center gap-3 cursor-pointer"><input type="checkbox" aria-label={`${account.name} 선택`} checked={selected.has(account.id)} disabled={busy || account.protected || subscribed(account)} onChange={() => setSelected((current) => { const next = new Set(current); next.has(account.id) ? next.delete(account.id) : next.add(account.id); return next; })} className="accent-emerald-500" />
          {account.profileImageUrl && <img src={account.profileImageUrl} alt="" loading="lazy" className="w-8 h-8 rounded-full shrink-0" />}
          <span className="min-w-0"><strong className="block text-sm truncate">{account.name}</strong><span className="text-xs text-slate-400">@{account.username}{subscribed(account) ? ' · 구독 중' : ''}</span></span>
          {account.protected && <LockKeyhole aria-label="비공개" className="h-4 w-4 text-slate-400" />}
        </label><a href={`https://x.com/${account.username}`} target="_blank" rel="noopener noreferrer" aria-label={`${account.name} X 프로필 열기`} className="p-2 text-slate-400"><ExternalLink className="w-4 h-4" /></a>
      </li>)}</ul>
      {shown.length > visible && <button type="button" onClick={() => setVisible((value) => value + 100)} className="text-xs text-emerald-500 cursor-pointer">계정 더 보기 ({visible.toLocaleString()} / {shown.length.toLocaleString()})</button>}
      <label className="block space-y-2 text-xs"><span>저장할 폴더</span><input value={folder} maxLength={120} disabled={busy} onChange={(event) => setFolder(event.target.value)} className={input} placeholder="폴더 없이 추가" /></label>
      <button type="button" disabled={busy || !selectedCount} onClick={importSelected} className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-slate-950 text-sm font-bold cursor-pointer disabled:opacity-40">선택한 {selectedCount}개 계정 구독</button>
    </>}
    {loaded && !accounts.length && <p className="text-center text-sm text-slate-400 py-6">팔로우 중인 계정이 없습니다.</p>}
    {report && <div role="status" className="space-y-2 text-xs"><p>{report.processed}개 처리 · 신규 구독 {report.imported}개 · 기존 구독 {report.existing}개 · 실패 {report.failures.length}개</p>{report.failures.length > 0 && <details><summary className="cursor-pointer text-rose-500">실패한 계정 확인</summary><ul className="mt-2 space-y-2">{report.failures.map((failure) => <li key={failure.account.id}>@{failure.account.username} · {failure.error}{failure.saved ? ' (실패 목록에 저장됨)' : ' (이 화면에만 보관됨)'}</li>)}</ul></details>}</div>}
  </section>;
}
