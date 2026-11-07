import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Share2, X } from 'lucide-react';
import { installAddress, installPlatform, isIOSSafari, openInstallHelp, promptInstall, useInstallState } from '../client/pwa';
import { inNativeApp } from '../client/nativeApp';
import { MAC_APP_DOWNLOAD, onMacBrowser } from '../shared/macApp';

const platform = () => installPlatform(navigator.userAgent, navigator.maxTouchPoints);
const SNOOZE_KEY = 'sfeed:install-snooze';
const snoozed = () => { try { return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < 86400000; } catch { return false; } };

// 모바일 보관함 위쪽 카드가 쓰는 설치 안내. 데스크톱은 위쪽 '앱 설치' 버튼 하나로 안내한다.
function useInstallPrompt() {
  const state = useInstallState();
  const ios = platform() === 'ios';
  const needsSafari = ios && !isIOSSafari(navigator);
  const nativePrompt = !ios && state === 'prompt';
  const [hidden, setHidden] = useState(snoozed);
  return {
    visible: state !== 'installed' && !hidden,
    nativePrompt,
    title: ios ? '홈 화면에서 FeedEx 열기' : 'FeedEx를 앱으로 사용하세요',
    text: ios ? 'Safari에서 홈 화면에 추가할 수 있어요.' : '홈 화면에서 바로 열고 편하게 읽으세요.',
    action: needsSafari ? 'Safari로 열기' : nativePrompt ? '설치' : '설치 안내',
    act: async () => { if (ios || !(await promptInstall())) openInstallHelp(); },
    dismiss: () => { setHidden(true); try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch {} },
  };
}

function InstallPromptContent({ prompt }: { prompt: ReturnType<typeof useInstallPrompt> }) {
  return <>
    <img src="/icons/icon-192.png" alt="" width="40" height="40" />
    <div className="min-w-0 flex-1"><strong className="block text-sm">{prompt.title}</strong><p className="text-xs text-slate-400 mt-1">{prompt.text}</p></div>
    <button type="button" onClick={() => { void prompt.act(); }} className="shrink-0 bg-emerald-500 text-slate-950 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer">{prompt.action}</button>
    <button type="button" aria-label="설치 안내 하루 동안 숨기기" onClick={prompt.dismiss} className="text-slate-400 p-1 cursor-pointer"><X size={16} /></button>
  </>;
}

/** 모바일 보관함 안에 카드로 보여 주는 설치 안내. */
export function InstallCard() {
  const prompt = useInstallPrompt();
  if (!prompt.visible) return null;
  return <aside className="feedex-install-card" aria-label="앱 설치 안내"><InstallPromptContent prompt={prompt} /></aside>;
}

/** 맥 브라우저에서 연 FeedEx에서만 맥 앱을 권한다. 맥 앱 안에서는 이미 쓰고 있다. */
export function macAppOffered(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0): boolean {
  return onMacBrowser(userAgent, touchPoints) && !inNativeApp();
}
/**
 * 앱 설치로 들어가는 곳은 위쪽 버튼 하나다. 브라우저 앱을 이미 설치했어도 맥에서는 맥 앱을 받을 수 있게 남긴다.
 * 아무것도 권할 게 없으면 null이다.
 */
export function installEntry(state: ReturnType<typeof useInstallState>, target: ReturnType<typeof platform>, mac: boolean, iosSafari: boolean): string | null {
  if (state === 'installed') return mac ? '맥 앱 받기' : null;
  return target === 'ios' ? iosSafari ? '홈 화면 추가 안내' : 'Safari로 열기' : '앱 설치';
}
export function InstallAppButton() {
  const state = useInstallState();
  const label = installEntry(state, platform(), macAppOffered(), typeof navigator !== 'undefined' && isIOSSafari(navigator));
  if (!label) return null;
  return <button type="button" onClick={openInstallHelp} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"><Download size={16} />{label}</button>;
}

/** 맥이면 안내 창 맨 위에 맥 앱을 둔다. 웹 보기에서 언론사 로그인이 유지되는 것은 맥 앱뿐이다. */
function MacAppOption() {
  return <section className="feedex-install-mac" aria-label="맥 앱">
    <div className="flex items-center justify-between gap-3"><strong className="text-sm">맥 앱</strong><a href={MAC_APP_DOWNLOAD} download="FeedEx-for-Mac.zip" className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950">받기</a></div>
    <p className="mt-2 text-xs leading-5">웹 보기에서 언론사 로그인이 유지되는 맥 앱이에요. 받은 zip을 풀어 응용 프로그램 폴더에 넣으세요. 처음 열 때 경고가 뜨면 시스템 설정 → 개인정보 보호 및 보안에서 '그래도 열기'를 누르세요.</p>
  </section>;
}

export function PwaInstall() {
  const state = useInstallState();
  const target = platform();
  const ios = target === 'ios';
  const needsSafari = ios && !isIOSSafari(navigator);
  const prompt = useInstallPrompt();
  const mac = macAppOffered();
  // 브라우저 앱을 이미 설치한 맥에서는 맥 앱만 안내한다.
  const browserSteps = state !== 'installed';
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const address = typeof window !== 'undefined' && window.location ? installAddress(window.location.href) : '';
  useEffect(() => { const show = (event: Event) => { const status = (event as CustomEvent<{ safariFailed?: boolean; copied?: boolean }>).detail; setCopyStatus(status?.safariFailed ? status.copied ? '주소를 복사했습니다. Safari를 열어 주소창에 붙여넣어 주세요.' : 'Safari가 열리지 않으면 아래 주소를 복사해 Safari에서 열어 주세요.' : ''); setOpen(true); }; window.addEventListener('sfeed:install', show); return () => window.removeEventListener('sfeed:install', show); }, []);
  useEffect(() => { if (open) { dialog.current?.showModal(); closeButton.current?.focus(); } else dialog.current?.close(); }, [open]);
  useEffect(() => { if (state === 'installed' && !mac) setOpen(false); }, [state, mac]);
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); setCopyStatus('주소를 복사했습니다. Safari 주소창에 붙여넣어 주세요.'); }
    catch { addressInput.current?.focus(); addressInput.current?.select(); setCopyStatus('아래 주소를 길게 눌러 복사한 뒤 Safari에서 열어 주세요.'); }
  };
  return <>
    <dialog ref={dialog} aria-labelledby="install-title" className="feedex-install-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === dialog.current) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } }}>
      <div className="flex items-center gap-3 mb-5"><img src="/icons/icon-192.png" alt="" width="44" height="44" /><h2 id="install-title" className="text-xl font-bold">{ios ? '홈 화면에 추가' : browserSteps ? 'FeedEx 앱 설치' : '맥 앱 받기'}</h2></div>
      {mac && <MacAppOption />}
      {browserSteps && <>
      {mac && <p className="mt-5 mb-3 text-xs font-semibold">브라우저 앱으로 설치</p>}
      <p className="text-sm text-slate-400 leading-6 mb-5">{ios ? needsSafari ? 'Safari로 열기를 누르면 설치할 수 있는 브라우저로 이동합니다. 이동되지 않으면 아래 주소를 복사해 Safari에서 열어 주세요.' : 'Safari의 공유 메뉴에서 홈 화면에 추가할 수 있어요.' : '홈 화면이나 Dock에서 브라우저 주소창 없이 FeedEx를 열 수 있어요.'}</p>
      {needsSafari && <button type="button" onClick={openInstallHelp} className="mb-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950">Safari로 열기</button>}
      {ios && <div className="feedex-install-address"><label htmlFor="feedex-install-address">Safari에서 열 주소</label><div><input id="feedex-install-address" ref={addressInput} readOnly value={address} onFocus={(event) => event.target.select()} /><button type="button" onClick={() => { void copyAddress(); }}><Copy size={16} />주소 복사</button></div>{copyStatus && <p role="status">{copyStatus}</p>}</div>}
      <ol className="list-decimal pl-5 space-y-3 text-sm leading-6">
        {ios ? <><li>Safari에서 <strong>FeedEx 주소</strong>를 여세요.</li><li><Share2 size={16} className="inline-block align-text-bottom mr-1" /><strong>공유 → 홈 화면에 추가</strong>를 선택하세요. 공유 버튼이 없으면 주소창의 페이지 메뉴(⋯)를 먼저 누르세요.</li><li><strong>웹 앱으로 열기</strong>가 보이면 켠 뒤 <strong>추가</strong>를 누르세요.</li><li>홈 화면의 <strong>FeedEx 아이콘</strong>을 눌러 실행하세요.</li></> : target === 'mac-safari' ? <><li>Safari 메뉴 막대에서 <strong>파일 → Dock에 추가…</strong>를 선택하세요.</li><li>이름을 확인하고 <strong>추가</strong>를 누르세요.</li></> : target === 'android' ? <><li>브라우저 메뉴 <strong>⋮</strong>를 누르세요.</li><li><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</li><li>설치 버튼이 보이면 눌러 완료하세요.</li></> : <><li>주소창 오른쪽의 <strong>설치 아이콘</strong>이나 브라우저 메뉴를 여세요.</li><li><strong>FeedEx 설치</strong> 또는 <strong>앱 설치</strong>를 선택하세요.</li><li>설치 메뉴가 없으면 Chrome·Edge 또는 Safari에서 열어 주세요.</li></>}
      </ol>
      {ios && <p className="mt-4 text-xs leading-5 text-slate-400">홈 화면에 추가가 없으면 공유 목록 아래의 <strong>동작 편집</strong>에서 추가하세요. <a href="https://support.apple.com/ko-kr/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer" className="text-emerald-500 underline">Apple 설치 안내</a></p>}
      </>}
      <p className="mt-5 text-xs text-slate-400 leading-5">설치한 앱에서는 Google 로그인이 다시 필요할 수 있어요. 같은 계정으로 로그인하면 구독과 읽음 상태가 이어집니다.</p>
      <div className="flex justify-end gap-2 mt-6">{prompt.nativePrompt && <button type="button" onClick={() => { void prompt.act(); }} className="rounded-xl border border-emerald-500 text-emerald-400 px-5 py-2.5 text-sm font-bold cursor-pointer">지금 설치</button>}<button ref={closeButton} type="button" onClick={() => setOpen(false)} className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2.5 text-sm font-bold cursor-pointer">알겠어요</button></div>
    </dialog>
  </>;
}
