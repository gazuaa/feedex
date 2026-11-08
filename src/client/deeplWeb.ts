import { nativeBridge } from './nativeApp';

// DeepL API 없이 DeepL로 번역하기: 사용자의 DeepL 웹 번역기를 글이 채워진 상태로 연다.
// 로그인한 DeepL 계정과 구독(Pro)이 그대로 쓰인다. 주소 형식은 https://www.deepl.com/translator#<원문 언어>/<번역 언어>/<글>이다.
// 원문 언어에 auto를 주면 글이 채워지지 않아(2026-11 확인) 글자로 언어를 짐작해 넣는다.

/** 앱 안에서는 외부 브라우저로 넘기는 주소 길이에 한도가 있다(8192바이트). 그 안에 들어가게 글을 자른다. */
export const DEEPL_LINK_LIMIT = 8000;

/** 글자 모양으로 원문 언어를 짐작한다. 라틴 문자는 영어로 둔다. DeepL이 다른 언어면 바꾸자고 알려 준다. */
export function guessSourceLanguage(text: string): string {
  const count = (pattern: RegExp) => (text.match(pattern) || []).length;
  const kana = count(/[぀-ヿ]/g), han = count(/[一-鿿]/g), cyrillic = count(/[Ѐ-ӿ]/g), hangul = count(/[가-힣]/g);
  if (kana > 0 && kana + han > hangul) return 'ja';
  if (han > hangul && han > 0) return 'zh';
  if (cyrillic > 0 && cyrillic * 2 > (text.match(/[a-z]/gi) || []).length) return 'ru';
  return 'en';
}

/** 본문 HTML을 문단이 살아 있는 글로 바꾼다. */
export function htmlToText(html: string, parser: { parseFromString(text: string, type: 'text/html'): Document } = new DOMParser()): string {
  const document = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  document.querySelectorAll('script, style, noscript, figure img, svg').forEach((node) => node.remove());
  document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, pre, tr, br').forEach((node) => node.after(document.createTextNode('\n\n')));
  return (document.body?.textContent || document.documentElement.textContent || '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** DeepL 웹 번역기 주소. 너무 길면 문단 경계에서 자른다. */
export function deeplTranslatorUrl(text: string, limit = DEEPL_LINK_LIMIT): string {
  const source = guessSourceLanguage(text);
  const head = `https://www.deepl.com/translator#${source}/ko/`;
  let body = text.trim();
  while (body && head.length + encodeURIComponent(body).length > limit) {
    const cut = body.lastIndexOf('\n\n', Math.floor(body.length * 0.8));
    body = (cut > 0 ? body.slice(0, cut) : body.slice(0, Math.floor(body.length * 0.8))).trim();
  }
  return head + encodeURIComponent(body);
}

/** DeepL을 새 창으로 연다. 맥·윈도우 앱에서는 기본 브라우저로 연다. */
export function openInDeepL(text: string) {
  const url = deeplTranslatorUrl(text);
  const bridge = nativeBridge();
  if (bridge) bridge.postMessage({ type: 'openExternal', url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
