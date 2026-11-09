import { useEffect, type RefObject } from 'react';

// 웹 사본은 원문 스크립트를 실행하지 않으므로, 앱에서 전달한 색 구성으로 본문 색만 맞춘다.
// 사진·동영상·차트에는 반전 필터를 쓰지 않아 원래 색을 유지한다.
export const COPY_THEME_MARKUP = `<style data-sfeed-copy-theme>
html[data-sfeed-theme="dark"],html[data-sfeed-theme="dark"] body{color-scheme:dark!important;background-color:#0f172a!important;color:#e2e8f0!important}
html[data-sfeed-theme="light"]{color-scheme:light!important}
html[data-sfeed-theme="dark"] body :where(main,article,section,header,footer,nav,aside,div,table,thead,tbody,tr,td,th,blockquote,pre,code,form){background-color:transparent!important;border-color:#334155!important}
html[data-sfeed-theme="dark"] body :where(h1,h2,h3,h4,h5,h6,p,span,div,li,dt,dd,td,th,blockquote,pre,code,strong,b,em,i,small,time,label,figcaption,button,input,textarea,select){color:#e2e8f0!important;border-color:#334155!important}
html[data-sfeed-theme="dark"] body :where(a,a span,a strong){color:#6ee7b7!important}
html[data-sfeed-theme="dark"] body :where(button,input,textarea,select){background-color:#1e293b!important}
html[data-sfeed-theme="dark"] body hr{border-color:#334155!important}
</style><script nonce="sfeed-scroll">(()=>{const preference=matchMedia('(prefers-color-scheme: dark)');let appTheme=false;const apply=()=>{if(!appTheme)document.documentElement.dataset.sfeedTheme=preference.matches?'dark':'light'};addEventListener('message',event=>{if(event.source!==parent||!['dark','light'].includes(event.data?.sfeedTheme))return;appTheme=true;document.documentElement.dataset.sfeedTheme=event.data.sfeedTheme});const ready=()=>parent.postMessage({sfeedThemeReady:true},'*');apply();ready();addEventListener('load',ready);if(preference.addEventListener)preference.addEventListener('change',apply);else preference.addListener(apply)})()</script>`;

// 사본은 출처가 격리되어 있으므로 프레임을 다시 열지 않고 메시지로 앱의 선택을 전달한다.
export function useCopyTheme(frame: RefObject<HTMLIFrameElement | null>, isDark: boolean) {
  useEffect(() => {
    const apply = () => frame.current?.contentWindow?.postMessage({ sfeedTheme: isDark ? 'dark' : 'light' }, '*');
    const ready = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.sfeedThemeReady === true) apply();
    };
    window.addEventListener('message', ready);
    apply();
    return () => window.removeEventListener('message', ready);
  }, [frame, isDark]);
}
