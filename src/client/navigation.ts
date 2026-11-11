import { useLayoutEffect, useRef } from 'react';
import type { ScopeType } from './api';
import { bindSwipeBack } from './swipeBack';

export interface MobileLocation {
  scope: ScopeType;
  folderId: string | null;
  feedId: string | null;
  search: string;
  unread: boolean;
  /** 폴더나 피드 목록 안의 저장 탭. 예전 기록 항목에는 없다. */
  saved?: boolean;
  articleId: string | null;
  library: boolean;
}

interface Entry {
  version: 1;
  account: string;
  index: number;
  location: MobileLocation;
  list: number | null;
  library: number | null;
  scroll: number;
}
interface ReaderReturn {
  fallback: Entry;
  listIndex: number;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
}
const key = 'sfeedNavigation';
const normal = (location: MobileLocation): MobileLocation => ({ ...location, saved: location.saved === true });
const equal = (a: MobileLocation, b: MobileLocation) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
const sameList = (a: MobileLocation, b: MobileLocation) => a.scope === b.scope && a.folderId === b.folderId && a.feedId === b.feedId && a.unread === b.unread && Boolean(a.saved) === Boolean(b.saved) && a.search === b.search;
const root = (location: MobileLocation): MobileLocation => ({ ...location, articleId: null, library: true });

// 기록에는 이동 식별자만 둔다. 글 본문이나 토큰은 절대 넣지 않는다.
// 브라우저의 기록 스택을 그대로 써서 iOS 가장자리 밀기와 브라우저 뒤로/앞으로가 같게 동작한다.
export class MobileNavigation {
  private current: Entry;
  private restoring: MobileLocation | null = null;
  private observed: MobileLocation;
  private observedScroll = 0;
  private readerReturn: ReaderReturn | null = null;
  constructor(private history: Pick<History, 'length' | 'state' | 'pushState' | 'replaceState' | 'go'>, private account: string, initial: MobileLocation, private restore: (location: MobileLocation, scroll: number) => void) {
    this.observed = initial;
    this.current = this.read(history.state) ?? { version: 1, account, index: 0, location: root(initial), list: null, library: null, scroll: 0 };
    this.write(this.current, false);
    if (!equal(this.current.location, initial)) this.apply(this.current);
  }
  private read(state: unknown): Entry | null {
    const entry = (state as Record<string, Entry> | null)?.[key];
    if (entry?.version !== 1 || entry.account !== this.account || !Number.isInteger(entry.index) || entry.index < 0) return null;
    const loc = entry.location;
    if (!loc || !['all', 'today', 'saved', 'folder', 'feed'].includes(loc.scope) || typeof loc.search !== 'string' || typeof loc.unread !== 'boolean' || typeof loc.library !== 'boolean' || ![loc.folderId, loc.feedId, loc.articleId].every((id) => id === null || typeof id === 'string')) return null;
    return entry;
  }
  private write(entry: Entry, push: boolean) {
    this.history[push ? 'pushState' : 'replaceState']({ ...this.history.state, [key]: entry }, '');
    this.current = entry;
  }
  private apply(entry: Entry) {
    this.current = entry;
    // 비동기 popstate가 오기 전에 닫기 버튼이 React 상태를 먼저 바꿀 수 있다.
    // 그때 React는 같은 상태를 다시 그리지 않을 수 있으므로, 복원을 확인하려고
    // 다시 그릴 필요는 없다.
    this.restoring = equal(entry.location, this.observed) ? null : entry.location;
    this.restore(entry.location, entry.scroll);
  }
  pop(state: unknown) {
    let entry = this.read(state);
    if (this.readerReturn) {
      const pending = this.readerReturn;
      if (entry && entry.index > pending.listIndex) {
        this.continueReaderReturn(pending.listIndex - entry.index);
        return;
      }
      this.cancelReaderReturn();
      if (entry?.index === pending.listIndex) {
        this.completeReaderReturn(entry);
        return;
      }
    }
    // 보관함에는 글 목록이 없으므로, 목록에서 입력한 검색어는 보관함을 거쳐
    // 다음에 고르는 목록으로 이어진다.
    if (entry?.location.library && entry.location.search !== this.observed.search) {
      entry = { ...entry, location: { ...entry.location, search: this.observed.search } };
      this.write(entry, false);
    }
    if (entry) this.apply(entry);
    else {
      // 이전 로그인의 기록 항목으로 그 계정의 글을 다시 열면 안 된다.
      const safe = { ...this.current, index: 0, location: root(this.current.location), list: null, library: null, scroll: 0 };
      this.write(safe, false);
      this.apply(safe);
    }
  }
  canGoBack() { return this.current.index > 0 && !this.restoring && !this.readerReturn; }
  /** 목록에서 뒤로 가면 보관함으로 가는지, 목록의 이전 상태로 가는지. */
  backTarget(): 'library' | 'other' { return this.current.library !== null && this.current.library === this.current.index - 1 ? 'library' : 'other'; }
  back() { if (this.canGoBack()) this.history.go(-1); }
  cancelReaderReturn() {
    clearTimeout(this.readerReturn?.timer);
    this.readerReturn = null;
  }
  private completeReaderReturn(entry: Entry) {
    this.write(entry, false);
    // 보이는 목록과 스크롤은 그대로 둔다. 기다리는 동안 새 화면을 열었다면 그 선택을 기록한다.
    if (!equal(this.observed, entry.location)) this.record(this.observed, this.observedScroll);
  }
  private continueReaderReturn(delta: number) {
    const pending = this.readerReturn;
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.attempts++ >= this.history.length) {
      this.cancelReaderReturn();
      this.completeReaderReturn(pending.fallback);
      return;
    }
    // WebKit은 프레임을 지운 뒤에도 그 방문 기록을 남길 수 있다. 그 단계에서는
    // 바깥 페이지에 popstate가 오지 않으므로 목록 기록에 도착할 때까지 한 칸씩 간다.
    pending.timer = setTimeout(() => this.continueReaderReturn(-1), 120);
    this.history.go(delta);
  }
  record(location: MobileLocation, scroll = 0) {
    this.observed = location;
    this.observedScroll = scroll;
    if (this.readerReturn) return;
    if (this.restoring) {
      if (equal(location, this.restoring)) this.restoring = null;
      return;
    }
    const previous = this.current;
    if (equal(previous.location, location)) return;
    // 리더를 열기 전에 목록 위치를 기록한다. 목록은 마운트된 채로 남고,
    // 다시 불러오거나 범위를 바꾼 뒤에도 이 값으로 위치를 되살린다.
    if (!previous.location.articleId && !previous.location.library) this.write({ ...previous, scroll }, false);
    if (previous.location.articleId && !location.articleId && !location.library && sameList(previous.location, location) && previous.list !== null) {
      // 리더가 닫힌 뒤에만 이동한다. 원문 프레임이 살아 있으면 앱 대신 프레임의 방문 기록만 되돌아갈 수 있다.
      this.readerReturn = { fallback: { ...previous, location, list: previous.index }, listIndex: previous.list, attempts: 0 };
      this.continueReaderReturn(previous.list - previous.index);
      return;
    }
    if (!previous.location.library && location.library && previous.library !== null) {
      this.restoring = location;
      this.history.go(previous.library - previous.index);
      return;
    }
    // 검색창을 고칠 때 글자마다 뒤로 가기 단계가 생기면 안 된다.
    const typing = previous.location.search !== location.search && equal({ ...previous.location, search: location.search }, location);
    const index = previous.index + (typing ? 0 : 1);
    this.write({ version: 1, account: this.account, index, location,
      list: location.articleId ? previous.location.articleId ? previous.list : previous.index : location.library ? null : index,
      library: location.library ? null : previous.location.library ? previous.index : previous.library,
      scroll: location.articleId ? this.current.scroll : typing ? scroll : 0,
    }, !typing);
  }
}

export function useMobileNavigation(account: string | null, location: MobileLocation, restore: (location: MobileLocation, scroll: number) => void, getScroll: () => number) {
  const latest = useRef({ location, restore, getScroll });
  latest.current = { location, restore, getScroll };
  const controller = useRef<MobileNavigation | null>(null);
  useLayoutEffect(() => {
    if (!account) return;
    const navigation = new MobileNavigation(window.history, account, latest.current.location, (loc, scroll) => latest.current.restore(loc, scroll));
    controller.current = navigation;
    const pop = (event: PopStateEvent) => navigation.pop(event.state);
    window.addEventListener('popstate', pop);
    const unbindSwipe = bindSwipeBack(document, navigation);
    return () => { navigation.cancelReaderReturn(); unbindSwipe(); window.removeEventListener('popstate', pop); controller.current = null; };
  }, [account]);
  useLayoutEffect(() => { controller.current?.record(location, latest.current.getScroll()); });
}
