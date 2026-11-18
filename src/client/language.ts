import { langFromList, setLangResolver, type Lang } from '../shared/i18n';
import { nativeBridge } from './nativeApp';

/** 화면 언어 설정. 'system'은 기기 언어를 따른다. 기기마다 다를 수 있어 이 기기에만 저장한다. */
export type LanguagePreference = 'system' | Lang;
const STORAGE_KEY = 'feedex_language';

export function languagePreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch { /* 저장소를 못 쓰면 시스템 언어를 따른다. */ }
  return 'system';
}

export function systemLang(): Lang {
  if (typeof navigator === 'undefined') return 'ko';
  return langFromList(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function resolvedLang(preference = languagePreference()): Lang {
  return preference === 'system' ? systemLang() : preference;
}

let current: Lang = 'ko';

/** 앱을 그리기 전에 한 번 부른다. 언어를 정하고 문서의 lang도 맞춘다. */
export function startLanguage() {
  current = resolvedLang();
  setLangResolver(() => current);
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  if (typeof window !== 'undefined') window.addEventListener('languagechange', () => {
    if (languagePreference() === 'system' && systemLang() !== current) location.reload();
  });
}

/** 언어를 바꾸면 모든 문구를 처음부터 다시 그리도록 페이지를 새로 불러온다. */
export function changeLanguage(preference: LanguagePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch { return; }
  if (resolvedLang(preference) === current) {
    nativeBridge()?.postMessage({ type: 'language', preference });
    return;
  }
  location.reload();
}
