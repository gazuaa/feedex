// 열려 있는 탭과 홈 화면 앱은 새로 고치기 전까지 처음 받은 앱 코드를 계속 쓴다. 그래서 고친 것을
// 배포해도 오래 켜 둔 앱에는 닿지 않는다. 앱이 다시 화면에 나타날 때 서버의 앱 껍데기(index.html)가
// 가리키는 번들을 확인하고, 바뀌었으면 읽던 자리를 남긴 뒤 새로 고친다.
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

// 배포는 드물므로, 자주 나타났다 사라져도 1분에 한 번만 묻는다.
const CHECK_GAP = 60_000;
// 같은 번들로 바꾸려고 이미 새로 고쳤는데 아직 옛 번들이면(배포가 퍼지는 중 등) 그동안 다시 고치지 않는다.
const RETRY_GAP = 10 * 60_000;
const SWAP_KEY = 'sfeed:app-swap';

export interface AppVersionOptions {
  current: string;
  loadShell: () => Promise<string>;
  /** 입력 중이거나 대화상자가 열렸거나 저장 중인 변경이 있으면 false. 다음에 나타날 때 다시 본다. */
  canSwap: () => boolean;
  /** 새로 고치기 직전에 읽던 자리를 남긴다. */
  beforeSwap: () => void;
  reload: () => void;
  storage: Store | null;
  now?: () => number;
}

export class AppVersionWatch {
  private checkedAt = -Infinity;
  // 새 번들을 찾았지만 지금은 바꿀 수 없어 다음에 나타날 때로 미룬 것.
  private waiting: string | null = null;
  private running: Promise<void> | null = null;
  constructor(private options: AppVersionOptions) {}
  /** 앱이 다시 화면에 나타날 때 부른다. */
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
      // 연결이 없으면 다음에 나타날 때 다시 묻는다.
      try { html = await this.options.loadShell(); } catch { return; }
      const bundle = shellBundle(html);
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

// 다른 창이나 앱에 이만큼 머물다 돌아오면 다시 나타난 것으로 본다.
const AWAY = 60_000;
/**
 * 탭·앱 전환, 화면 잠금 해제, 뒤로 가기 캐시에서 되살아남, 다른 창에 오래 있다가 돌아옴을
 * "다시 나타남"으로 보고 새 배포를 확인한다. 개발 서버처럼 번들이 없으면 아무것도 하지 않는다.
 */
export function watchAppVersion(options: Pick<AppVersionOptions, 'canSwap' | 'beforeSwap'>): () => void {
  const current = runningBundle(document); if (!current) return () => {};
  const watch = new AppVersionWatch({
    ...options, current, storage: session(), reload: () => window.location.reload(),
    loadShell: async () => {
      const response = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`앱 껍데기 응답 오류 (HTTP ${response.status})`);
      return response.text();
    },
  });
  let leftAt: number | null = null, blurTimer: ReturnType<typeof setTimeout> | undefined;
  const visible = () => { if (document.visibilityState === 'visible') void watch.check(); };
  const shown = (event: PageTransitionEvent) => { if (event.persisted) void watch.check(); };
  // 웹 사본 프레임을 누르면 창의 초점이 잠깐 프레임으로 가지만 문서는 여전히 초점을 가진다.
  // 그때는 떠난 것으로 치지 않는다.
  const blurred = () => { clearTimeout(blurTimer); blurTimer = setTimeout(() => { if (!document.hasFocus()) leftAt = Date.now(); }, 0); };
  const focused = () => { clearTimeout(blurTimer); if (leftAt !== null && Date.now() - leftAt >= AWAY) void watch.check(); leftAt = null; };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pageshow', shown);
  window.addEventListener('blur', blurred);
  window.addEventListener('focus', focused);
  return () => {
    clearTimeout(blurTimer);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('pageshow', shown);
    window.removeEventListener('blur', blurred);
    window.removeEventListener('focus', focused);
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
  articleId: string | null;
  listScroll: number;
  readerScroll: number;
}
const RESUME_KEY = 'sfeed:resume';
// 새로 고침 뒤 앱이 다시 뜨기까지 걸리는 시간보다 넉넉하게. 오래된 자리는 쓰지 않는다.
const RESUME_AGE = 2 * 60_000;
// 탭 안에만 남는 저장소에 글과 목록 식별자, 스크롤 위치만 둔다. 본문이나 토큰은 넣지 않는다.
export function keepResumePoint(point: ResumePoint, storage = session()) {
  try { storage?.setItem(RESUME_KEY, JSON.stringify(point)); } catch {}
}
/** 새로 고치기 직전에 남긴 자리. 같은 계정이고 방금 남긴 것만 한 번 돌려준다. */
export function takeResumePoint(account: string, now = Date.now(), storage = session()): ResumePoint | null {
  let point: Partial<ResumePoint> | null;
  try { point = JSON.parse(storage?.getItem(RESUME_KEY) || 'null'); storage?.removeItem(RESUME_KEY); } catch { return null; }
  if (!point || typeof point !== 'object' || point.account !== account || typeof point.at !== 'number' || now - point.at < 0 || now - point.at > RESUME_AGE) return null;
  const id = (value: unknown) => value === null || value === undefined ? null : typeof value === 'string' && value.length <= 200 ? value : undefined;
  const scroll = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  const folderId = id(point.folderId), feedId = id(point.feedId), articleId = id(point.articleId);
  if (!['all', 'today', 'saved', 'folder', 'feed'].includes(point.scope as string) || typeof point.search !== 'string' || folderId === undefined || feedId === undefined || articleId === undefined) return null;
  return { account, at: point.at, scope: point.scope as ScopeType, folderId, feedId, search: point.search.slice(0, 500), saved: point.saved === true, articleId, listScroll: scroll(point.listScroll), readerScroll: scroll(point.readerScroll) };
}
