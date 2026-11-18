import { AsyncLocalStorage } from 'node:async_hooks';
import { LANG_HEADER, langFromList, parseLang, setLangResolver, type Lang } from '../shared/i18n';

// 요청마다 화면 언어를 기억한다. 깊은 곳의 오류 문구도 `t()`만 부르면 그 요청의 언어로 나온다.
// 요청 밖(정해진 시각의 갱신 작업 등)에서는 한국어로 둔다.
const store = new AsyncLocalStorage<Lang>();
setLangResolver(() => store.getStore() ?? 'ko');

export function requestLang(request: Request): Lang {
  return parseLang(request.headers.get(LANG_HEADER)) ?? langFromList(request.headers.get('Accept-Language'));
}

export function runWithLang<T>(value: Lang, task: () => T): T {
  return store.run(value, task);
}
