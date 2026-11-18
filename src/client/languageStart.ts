import { languagePreference, startLanguage } from './language';
import { nativeBridge } from './nativeApp';

// 다른 모듈이 문구를 만들기 전에 언어를 정한다. main.tsx에서 가장 먼저 불러온다.
startLanguage();
nativeBridge()?.postMessage({ type: 'language', preference: languagePreference() });
