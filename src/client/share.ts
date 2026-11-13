// 글 공유. 공유 사이트 주소와 복사할 글을 한 곳에서 만든다.
export interface SharedArticle { title: string; url: string }

/** 공유 사이트의 글쓰기 주소. 제목과 원문 주소만 넘긴다. */
export function shareLinks({ title, url }: SharedArticle) {
  return {
    // 해시만 바뀌는 이동과 구분해 설치된 Slap 앱에 새 공유를 전달한다.
    slap: `https://slap.jyk.workers.dev/?share=1#${new URLSearchParams({ share: url, title })}`,
    x: `https://x.com/intent/tweet?${new URLSearchParams({ url, text: title })}`,
    telegram: `https://t.me/share/url?${new URLSearchParams({ url, text: title })}`,
    threads: `https://www.threads.com/intent/post?${new URLSearchParams({ text: `${title}\n${url}` })}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n${url}`)}`,
  };
}

/** Slap 데스크톱 앱(Chrome·Edge에 설치한 Slap)을 바로 여는 전용 주소. Slap 매니페스트의 protocol_handlers가 받는다. */
export const slapAppLink = ({ title, url }: SharedArticle) => `web+slap:share?${new URLSearchParams({ url, title })}`;

/** 아이폰·아이패드. 홈 화면의 웹 앱은 링크로 열 수 없다(아이패드는 맥처럼 보이지만 터치가 여럿이다). */
export const isAppleTouch = (agent: string, touches: number) => /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && touches > 1);

/**
 * 전용 주소로 설치한 Slap 앱을 연다. 앱이 열리면 이 창이 포커스를 잃는다. 잠시 기다려도 그대로면 앱이 없거나 열리지
 * 않은 것으로 보고 알린다. 새 탭을 대신 열지 않는다(처음 한 번 브라우저가 열기 허락을 물을 때 둘 다 열릴 수 있어서).
 */
export function openSlapApp(link: string, onMissed: () => void, win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'location'> & { document: Pick<Document, 'addEventListener' | 'removeEventListener'> } = window, wait = 2000) {
  let left = false;
  const away = () => { left = true; };
  win.addEventListener('blur', away);
  win.document.addEventListener('visibilitychange', away);
  win.location.href = link;
  win.setTimeout(() => {
    win.removeEventListener('blur', away);
    win.document.removeEventListener('visibilitychange', away);
    if (!left) onMissed();
  }, wait);
}

/**
 * 클립보드에 글을 넣는다. 권한이 막힌 화면(일부 앱 화면 등)에서는 예전 방식(숨긴 글상자를 선택해 복사)으로
 * 한 번 더 시도한다. 그 뒤에는 원래 누르던 곳으로 초점을 돌려준다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 아래 방식으로 다시 시도한다. */ }
  const focused = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    focused?.focus?.({ preventScroll: true });
  }
}
