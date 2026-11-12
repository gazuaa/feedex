// 글 공유. 공유 사이트 주소와 복사할 글을 한 곳에서 만든다.
export interface SharedArticle { title: string; url: string }

/** 공유 사이트의 글쓰기 주소. 제목과 원문 주소만 넘긴다. */
export function shareLinks({ title, url }: SharedArticle) {
  return {
    slap: `https://slap.jyk.workers.dev/#${new URLSearchParams({ share: url, title })}`,
    x: `https://x.com/intent/tweet?${new URLSearchParams({ url, text: title })}`,
    telegram: `https://t.me/share/url?${new URLSearchParams({ url, text: title })}`,
    threads: `https://www.threads.com/intent/post?${new URLSearchParams({ text: `${title}\n${url}` })}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n${url}`)}`,
  };
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
