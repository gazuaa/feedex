// 열려 있는 탭과 홈 화면 앱은 새로 고치기 전까지 처음 받은 앱 코드를 계속 쓴다. 그래서 고친 것을
// 배포해도 오래 켜 둔 앱에는 닿지 않는다. 앱이 보이는 동안 정기적으로 앱 껍데기(index.html)의
// 화면 코드와 스타일을 확인하고, 바뀌었으면 읽던 자리를 남긴 뒤 새로 고친다.
import type { ScopeType } from './api';

const BUNDLE = /^\/assets\/[^/?#]+\.js$/;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const session = (): Store | null => { try { return window.sessionStorage; } catch { return null; } };

/** 앱 껍데기 HTML이 불러오는 번들 경로(/assets/index-….js). 개발 서버처럼 번들이 없으면 null. */
export function shellBundle(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (/\btype=["']module["']/i.test(tag) && src && BUNDLE.test(src)) return src;
  }
  return null;
}
/** 지금 실행 중인 번들 경로. */
export function runningBundle(doc: Pick<Document, 'querySelectorAll'>): string | null {
  for (const script of doc.querySelectorAll('script[type="module"][src]')) {
    const src = script.getAttribute('src');
    if (src && BUNDLE.test(src)) return src;
  }
  return null;
}

const STYLESHEET = /^\/assets\/[^/?#]+\.css$/;
const versionKey = (bundle: string | null, styles: string[]) => bundle ? [bundle, ...styles.sort()].join('|') : null;
/** 스타일만 바뀐 배포도 감지한다. 외부 로그인 스크립트나 사이트별 스타일은 제외한다. */
export function shellVersion(html: string): string | null {
  const styles = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (/\brel=["']stylesheet["']/i.test(tag) && href && STYLESHEET.test(href)) styles.push(href);
  }
  return versionKey(shellBundle(html), styles);
}
export function runningVersion(doc: Pick<Document, 'querySelectorAll'>): string | null {
  const styles = Array.from(doc.querySelectorAll('link[rel="stylesheet"][href]')).map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href && STYLESHEET.test(href)));
  return versionKey(runningBundle(doc), styles);
}

// 배포는 드물므로, 자주 나타났다 사라져도 1분에 한 번만 묻는다.
const CHECK_GAP = 60_000;
// 같은 번들로 바꾸려고 이미 새로 고쳤는데 아직 옛 번들이면(배포가 퍼지는 중 등) 그동안 다시 고치지 않는다.
const RETRY_GAP = 10 * 60_000;
const SWAP_KEY = 'sfeed:app-swap';

export interface AppVersionOptions {
  current: string;
  loadShell: () => Promise<string>;
  /** 입력 중이거나 대화상자가 열렸거나 저장 중인 변경이 있으면 false. 다음 확인 때 다시 본다. */
  canSwap: () => boolean;
  /** 새로 고치기 직전에 읽던 자리를 남긴다. */
  beforeSwap: () => void;
  reload: () => void;
  storage: Store | null;
  now?: () => number;
}

export class AppVersionWatch {
  private checkedAt = -Infinity;
  // 새 번들을 찾았지만 지금은 바꿀 수 없어 다음 확인으로 미룬 것.
  private waiting: string | null = null;
  private running: Promise<void> | null = null;
  constructor(private options: AppVersionOptions) {}
  /** 앱이 보이는 동안 정기적으로, 또는 앱으로 돌아왔을 때 부른다. */
  check(): Promise<void> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  private async run() {
    const now = (this.options.now ?? Date.now)();
    let next = this.waiting;
    if (!next) {
      if (now - this.checkedAt < CHECK_GAP) return;
      this.checkedAt = now;
      let html: string;
      // 연결이 없으면 다음 확인 때 다시 묻는다.
      try { html = await this.options.loadShell(); } catch { return; }
      const bundle = shellVersion(html);
      if (!bundle || bundle === this.options.current) return;
      next = bundle;
    }
    if (this.triedRecently(next, now)) { this.waiting = null; return; }
    if (!this.options.canSwap()) { this.waiting = next; return; }
    this.waiting = null;
    try { this.options.storage?.setItem(SWAP_KEY, JSON.stringify({ to: next, at: now })); } catch {}
    this.options.beforeSwap();
    this.options.reload();
  }
  private triedRecently(bundle: string, now: number) {
    try {
      const last = JSON.parse(this.options.storage?.getItem(SWAP_KEY) || 'null');
      return last?.to === bundle && now - last.at >= 0 && now - last.at < RETRY_GAP;
    } catch { return false; }
  }
}

/** 화면을 켜 둔 맥 앱에서도 새 배포를 확인한다. 숨겨진 동안에는 요청하지 않는다. */
export function watchAppVersion(options: Pick<AppVersionOptions, 'canSwap' | 'beforeSwap'>): () => void {
  const current = runningVersion(document); if (!current) return () => {};
  let active = true;
  const watch = new AppVersionWatch({
    ...options, current, storage: session(),
    canSwap: () => active && document.visibilityState === 'visible' && options.canSwap(),
    reload: () => window.location.reload(),
    loadShell: async () => {
      const response = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`앱 껍데기 응답 오류 (HTTP ${response.status})`);
      return response.text();
    },
  });
  const visible = () => { if (active && document.visibilityState === 'visible') void watch.check(); };
  const shown = (event: PageTransitionEvent) => { if (event.persisted) visible(); };
  let settled: ReturnType<typeof setTimeout> | undefined;
  // 다른 입력칸으로 옮기는 도중에는 새로 고치지 않는다. 새 포커스가 정해진 다음 확인한다.
  const afterInput = () => { clearTimeout(settled); settled = setTimeout(visible, 0); };
  const interval = window.setInterval(visible, CHECK_GAP);
  document.addEventListener('visibilitychange', visible);
  document.addEventListener('focusout', afterInput);
  window.addEventListener('pageshow', shown);
  window.addEventListener('focus', visible);
  window.addEventListener('online', visible);
  visible();
  return () => {
    active = false;
    clearTimeout(settled);
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', visible);
    document.removeEventListener('focusout', afterInput);
    window.removeEventListener('pageshow', shown);
    window.removeEventListener('focus', visible);
    window.removeEventListener('online', visible);
  };
}

export interface ResumePoint {
  account: string;
  at: number;
  scope: ScopeType;
  folderId: string | null;
  feedId: string | null;
  search: string;
  saved: boolean;
  unread?: boolean;
  articleId: string | null;
  listScroll: number;
  readerScroll: number;
  /** 원문을 읽으러 이 창에서 떠난 자리. 원문을 읽고 돌아오는 동안 더 오래 기다린다. */
  original?: boolean;
}
const RESUME_KEY = 'sfeed:resume';
// 새로 고침 뒤 앱이 다시 뜨기까지 걸리는 시간보다 넉넉하게. 오래된 자리는 쓰지 않는다.
const RESUME_AGE = 2 * 60_000;
const ORIGINAL_RESUME_AGE = 60 * 60_000;
// 탭 안에만 남는 저장소에 글과 목록 식별자, 스크롤 위치만 둔다. 본문이나 토큰은 넣지 않는다.
export function keepResumePoint(point: ResumePoint, storage = session()) {
  try { storage?.setItem(RESUME_KEY, JSON.stringify(point)); } catch {}
}
/** 새로 고치기 직전에 남긴 자리. 같은 계정이고 방금 남긴 것만 한 번 돌려준다. */
export function takeResumePoint(account: string, now = Date.now(), storage = session()): ResumePoint | null {
  let point: Partial<ResumePoint> | null;
  try { point = JSON.parse(storage?.getItem(RESUME_KEY) || 'null'); storage?.removeItem(RESUME_KEY); } catch { return null; }
  if (!point || typeof point !== 'object' || point.account !== account || typeof point.at !== 'number' || now - point.at < 0 || now - point.at > (point.original === true ? ORIGINAL_RESUME_AGE : RESUME_AGE)) return null;
  const id = (value: unknown) => value === null || value === undefined ? null : typeof value === 'string' && value.length <= 200 ? value : undefined;
  const scroll = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const folderId = id(point.folderId), feedId = id(point.feedId), articleId = id(point.articleId);
  if (!['all', 'today', 'saved', 'folder', 'feed'].includes(point.scope as string) || typeof point.search !== 'string' || folderId === undefined || feedId === undefined || articleId === undefined) return null;
  return { account, at: point.at, scope: point.scope as ScopeType, folderId, feedId, search: point.search.slice(0, 500), saved: point.saved === true, ...(typeof point.unread === 'boolean' ? { unread: point.unread } : {}), articleId, listScroll: scroll(point.listScroll), readerScroll: scroll(point.readerScroll), ...(point.original === true ? { original: true } : {}) };
}
