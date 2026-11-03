import { useCallback, useSyncExternalStore } from 'react';
import type { ArticleItem } from './api';
import { compileArticleBlocks, readArticleBlocks } from './articleBlocks';

const settingKey = (account: string) => `sfeed_local_notifications:${account}`;
const seenKey = (account: string) => `sfeed_notified_articles:${account}`;
const listeners = new Set<() => void>();
export function localNotificationsEnabled(account: string) {
  try { return Boolean(account && localStorage.getItem(settingKey(account)) === 'true' && typeof Notification !== 'undefined' && Notification.permission === 'granted'); } catch { return false; }
}
export function setLocalNotifications(account: string, enabled: boolean) {
  try { localStorage.setItem(settingKey(account), String(enabled)); } catch { /* 세션 전용 환경에서는 저장소가 막혀 있을 수 있다 */ }
  listeners.forEach((listener) => listener());
}
export function useLocalNotifications(account: string) {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    window.addEventListener('storage', listener); window.addEventListener('focus', listener);
    return () => { listeners.delete(listener); window.removeEventListener('storage', listener); window.removeEventListener('focus', listener); };
  }, [account]);
  return useSyncExternalStore(subscribe, () => localNotificationsEnabled(account), () => false);
}
export async function enableLocalNotifications(account: string): Promise<string> {
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return '이 브라우저에서는 알림을 지원하지 않습니다. 아이폰은 홈 화면에 설치한 앱에서 확인해 주세요.';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return '기기 또는 브라우저 설정에서 알림을 허용해 주세요.';
  setLocalNotifications(account, true);
  return '';
}
export async function notifyNewArticles(account: string, articles: ArticleItem[], show?: (title: string, options: NotificationOptions) => Promise<void>, current: () => boolean = () => true) {
  if (!localNotificationsEnabled(account) || !articles.length) return;
  const deliver = async () => {
    if (!localNotificationsEnabled(account) || !current()) return;
    let previous: string[] = [];
    try { previous = JSON.parse(localStorage.getItem(seenKey(account)) || '[]'); if (!Array.isArray(previous)) previous = []; } catch { /* 형식이 잘못된 기록은 무시한다 */ }
    let rules = readArticleBlocks(account), blocked = compileArticleBlocks(rules);
    const seen = new Set(previous), fresh = articles.filter((article) => !seen.has(article.id) && !blocked(article));
    if (!fresh.length) return;
    let display = show;
    if (!display) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active || !registration.showNotification) return;
      display = (title, options) => registration.showNotification(title, options);
    }
    for (const article of fresh) {
      if (!localNotificationsEnabled(account) || !current()) break;
      const latest = readArticleBlocks(account);
      if (latest !== rules) { rules = latest; blocked = compileArticleBlocks(rules); }
      if (blocked(article)) continue;
      if (seen.has(article.id)) continue;
      seen.add(article.id);
      try { localStorage.setItem(seenKey(account), JSON.stringify([...seen].slice(-1000))); } catch { /* 알림 태그로도 중복을 거른다 */ }
      const feed = article.feed_title?.trim() || 'FeedEx';
      // macOS는 제목과 본문 사이에 브라우저 출처 부제를 넣는다. 글 내용은 모두 그 위에 둔다.
      // iPad의 데스크톱 UA도 여전히 모바일이다.
      const mac = /Macintosh|Mac OS X/.test(navigator.userAgent || '') && !/iPhone|iPad|iPod/.test(navigator.userAgent || '') && !(navigator.maxTouchPoints > 1);
      await display(mac ? `${feed} · ${article.title}` : feed, { ...(!mac ? { body: article.title } : {}), tag: `sfeed-${account}-${article.id}`, icon: '/icons/icon-192.png', data: { account, articleId: article.id } });
    }
  };
  if (navigator.locks) await navigator.locks.request(`sfeed-notifications:${account}`, { ifAvailable: true }, (lock) => lock ? deliver() : undefined);
  else await deliver();
}
