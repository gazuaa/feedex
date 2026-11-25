// 글 공유. 공유 사이트 주소와 복사할 글을 한 곳에서 만든다.
export interface SharedArticle { title: string; url: string }

/** 공유 사이트의 글쓰기 주소. 제목과 원문 주소만 넘긴다. */
export function shareLinks({ title, url }: SharedArticle) {
  return {
    // 해시만 바뀌는 이동과 구분해 설치된 Slap 앱에 새 공유를 전달한다.
    slap: `https://slap.jyk.workers.dev/?share=1#${new URLSearchParams({ share: url, title })}`,
    x: `https://x.com/intent/tweet?${new URLSearchParams({ url, text: title })}`,
    telegram: `https://t.me/share/url?${new URLSearchParams({ url, text: title })}`,
    // 텔레그램 앱을 바로 여는 주소. 아이폰 홈 화면 앱에서 t.me를 열면 앱 안 사파리 창이 텔레그램으로 넘긴 뒤 빈 창으로 남는다.
    telegramApp: `tg://msg_url?${new URLSearchParams({ url, text: title })}`,
    threads: `https://www.threads.com/intent/post?${new URLSearchParams({ text: `${title}\n${url}` })}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${title}\n${url}`)}`,
  };
}

/** 글을 넘겨 물어볼 AI. 중간 페이지(/grok.html)도 이 네 곳으로만 넘긴다. */
export type AskService = 'grok' | 'chatgpt' | 'claude' | 'gemini';
const ASK_BASE: Record<AskService, string> = { grok: 'https://grok.com/', chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app' };
/** 주소로 질문을 받지 않는 서비스. 링크를 클립보드에 넣어 두고 열어서 붙여넣게 한다. */
export const askNeedsPaste = (service: AskService) => service === 'gemini';

/**
 * AI에 묻기 주소. 질문창에 글 주소만 채운다. 휴대폰은 서비스 주소를 바로 열면 그 앱이 질문을 버리므로
 * 피드엑스의 중간 페이지(/grok.html)를 거친다.
 */
export function askLink(service: AskService, url: string, phone: boolean) {
  const query = new URLSearchParams({ q: url });
  if (!phone) return `${ASK_BASE[service]}?${query}`;
  return `/grok.html?${service === 'grok' ? '' : `to=${service}&`}${query}`;
}
export const grokLink = (url: string, phone: boolean) => askLink('grok', url, phone);

// 다른 앱(Grok 등)으로 다녀오는 중인지. 돌아왔을 때 오래 떠나 있었다고 보고 읽은 행을 빼지 않게 한다.
let externalTrip = 0;
export const noteExternalTrip = (now = Date.now()) => { externalTrip = now; };
/** 다른 앱에 다녀온 길인지 한 번만 알려 준다. */
export function tookExternalTrip(now = Date.now(), within = 60 * 60_000) {
  const yes = externalTrip > 0 && now - externalTrip < within;
  externalTrip = 0;
  return yes;
}

/**
 * AI(Grok·ChatGPT)에 묻기를 연다(맥·윈도우 앱은 부르는 쪽에서 기본 브라우저로 연다).
 * - 컴퓨터: 질문을 채운 grok.com을 새 탭으로 연다.
 * - 아이폰 홈 화면 앱: 피드엑스 페이지를 떠나지 않고 그 자리에서 스크립트로 grok.com을 열어 Grok 앱에 넘긴다.
 *   예전처럼 중간 페이지를 열면 그 페이지가 피드엑스를 대신해서, 돌아올 때 피드엑스가 처음부터 다시 떠 읽은 행이 사라졌다.
 *   누름과 이어지지 않게 잠깐 뒤에 넘겨야 Grok 앱이 질문까지 받는다.
 * - 그 밖의 휴대폰: 중간 페이지를 새 탭으로 연다.
 */
export function openAsk(service: AskService, url: string, phone: boolean, standalone: boolean, win: Pick<Window, 'open' | 'setTimeout' | 'location'> = window) {
  noteExternalTrip();
  if (!phone) { win.open(askLink(service, url, false), '_blank', 'noopener,noreferrer'); return; }
  if (standalone) { const target = askLink(service, url, false); win.setTimeout(() => { win.location.href = target; }, 60); return; }
  win.open(askLink(service, url, true), '_blank', 'noopener,noreferrer');
}
export const openGrok = (url: string, phone: boolean, standalone: boolean, win?: Pick<Window, 'open' | 'setTimeout' | 'location'>) => openAsk('grok', url, phone, standalone, win);

/** Slap 데스크톱 앱(Chrome·Edge에 설치한 Slap)을 바로 여는 전용 주소. Slap 매니페스트의 protocol_handlers가 받는다. */
export const slapAppLink = ({ title, url }: SharedArticle) => `web+slap:share?${new URLSearchParams({ url, title })}`;

/** 아이폰·아이패드. 홈 화면의 웹 앱은 링크로 열 수 없다(아이패드는 맥처럼 보이지만 터치가 여럿이다). */
export const isAppleTouch = (agent: string, touches: number) => /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && touches > 1);

/**
 * 전용 주소로 설치한 앱(Slap, 텔레그램 등)을 연다. 앱이 열리면 이 창이 포커스를 잃는다. 잠시 기다려도 그대로면 앱이 없거나 열리지
 * 않은 것으로 보고 알린다. 새 탭을 대신 열지 않는다(처음 한 번 브라우저가 열기 허락을 물을 때 둘 다 열릴 수 있어서).
 */
export function openAppLink(link: string, onMissed: () => void, win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'location'> & { document: Pick<Document, 'addEventListener' | 'removeEventListener'> } = window, wait = 2000) {
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
 * 아이폰 홈 화면 앱에서 공유 링크를 연다. 홈 화면 앱은 바깥 주소를 앱 안 사파리 창으로 여는데, 그 주소가 다른 앱
 * (Grok, 텔레그램, X 등)으로 넘어가면 돌아왔을 때 빈 흰 창만 남는다. 그래서 연 창을 기억해 두었다가, 다른 앱에 다녀와
 * 이 앱이 다시 보이면 그 창을 닫는다. 연 사이트가 이 앱을 조작하지 못하게 opener는 바로 끊는다.
 * 원문 읽기처럼 그 창에서 계속 읽는 링크에는 쓰지 않는다(다른 앱을 잠깐 보고 오면 닫혀 버린다).
 */
export function openClosingOnReturn(url: string, win: Pick<Window, 'open' | 'setTimeout'> & { document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> } = window, keepMs = 10 * 60_000) {
  const opened = win.open(url, '_blank');
  if (!opened) return false;
  try { opened.opener = null; } catch { /* 이미 다른 출처로 넘어갔으면 브라우저가 막는다. */ }
  let away = false;
  const doc = win.document;
  const stop = () => doc.removeEventListener('visibilitychange', changed);
  function changed() {
    if (doc.visibilityState === 'hidden') { away = true; return; }
    if (!away) return;
    stop();
    try { if (!opened!.closed) opened!.close(); } catch { /* 닫을 수 없으면 그대로 둔다. */ }
  }
  doc.addEventListener('visibilitychange', changed);
  win.setTimeout(stop, keepMs);
  return true;
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
