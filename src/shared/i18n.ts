/**
 * 화면 언어. 문구는 쓰는 자리에서 `t('한국어', 'English')`처럼 두 언어를 함께 적는다.
 * 키 이름을 따로 두지 않으므로 빠뜨리거나 어긋날 일이 적다.
 * 브라우저는 사용자의 설정(또는 시스템 언어)으로, 서버는 요청마다 받은 언어로 정한다.
 */
export type Lang = 'ko' | 'en';

let resolveLang: () => Lang = () => 'ko';

/** 지금 언어를 어디서 읽을지 정한다. 브라우저는 시작할 때, 서버는 요청 문맥으로 한 번 정한다. */
export function setLangResolver(resolver: () => Lang) { resolveLang = resolver; }

export function lang(): Lang { return resolveLang(); }
export const isEnglish = () => lang() === 'en';

export function t(ko: string, en: string): string { return lang() === 'en' ? en : ko; }

/** 언어 머리글. 브라우저가 API 요청에 붙이고 서버가 읽는다. */
export const LANG_HEADER = 'X-Feedex-Lang';

export function parseLang(value: string | null | undefined): Lang | null {
  const code = value?.trim().toLowerCase();
  if (!code) return null;
  if (code === 'ko' || code.startsWith('ko-')) return 'ko';
  if (code === 'en' || code.startsWith('en-')) return 'en';
  return null;
}

/** Accept-Language 같은 목록에서 첫 언어를 고른다. 한국어가 아니면 영어로 본다. */
export function langFromList(list: readonly string[] | string | null | undefined): Lang {
  const items = typeof list === 'string' ? list.split(',').map(item => item.split(';')[0]) : list ?? [];
  const first = items.map(item => item.trim()).find(Boolean);
  if (!first) return 'ko';
  return parseLang(first) ?? 'en';
}

/** 날짜·숫자 표기에 쓰는 지역 코드. */
export const locale = () => lang() === 'en' ? 'en-US' : 'ko-KR';
