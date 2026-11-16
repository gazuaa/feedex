import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Apple, ChevronRight, Chrome, Compass, Copy, Download, Share, SquarePlus, X } from 'lucide-react';
import { installAddress, installPlatform, isIOSSafari, openInstallHelp, promptInstall, useInstallState } from '../client/pwa';
import { inNativeApp } from '../client/nativeApp';
import { launchDesktopApp, useKnownDesktopApp, type DesktopApp } from '../client/desktopApp';
import { MAC_APP_DOWNLOAD, MAC_APP_OPEN, MAC_SECURITY_SETTINGS, onMacBrowser } from '../shared/macApp';
import { WINDOWS_APP_DOWNLOAD, WINDOWS_APP_OPEN, onWindowsBrowser } from '../shared/windowsApp';

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
    // MUUSED와 같은 문구. 사파리에서는 방법을 보여 주고, 설치가 안 되는 다른 아이폰 브라우저에서는 사파리로 넘겨 준다.
    title: needsSafari ? '사파리로 열면 설치할 수 있어요' : ios ? '홈 화면에 앱 설치하기' : 'feedex를 앱으로 사용하세요',
    text: needsSafari ? '누르면 주소를 복사하고 사파리를 열어요' : ios ? '' : '홈 화면에서 바로 열고 편하게 읽으세요.',
    action: needsSafari ? '사파리로' : nativePrompt ? '설치' : ios ? '방법 보기' : '설치 안내',
    act: async () => { if (ios || !(await promptInstall())) openInstallHelp(); },
    dismiss: () => { setHidden(true); try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch {} },
  };
}

function InstallPromptContent({ prompt }: { prompt: ReturnType<typeof useInstallPrompt> }) {
  return <>
    <img src="/icons/icon-192.png" alt="" width="40" height="40" />
    <div className="min-w-0 flex-1"><strong className="block text-sm">{prompt.title}</strong>{prompt.text && <p className="text-xs text-slate-400 mt-1">{prompt.text}</p>}</div>
    <button type="button" onClick={() => { void prompt.act(); }} className="shrink-0 min-h-[40px] bg-emerald-500 text-slate-950 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer">{prompt.action}</button>
    <button type="button" aria-label="설치 안내 하루 동안 숨기기" onClick={prompt.dismiss} className="shrink-0 -mr-2 flex h-10 w-10 items-center justify-center text-slate-400 cursor-pointer"><X size={16} /></button>
  </>;
}

/** 모바일 보관함 안에 카드로 보여 주는 설치 안내. */
export function InstallCard() {
  const prompt = useInstallPrompt();
  if (!prompt.visible) return null;
  return <aside className="feedex-install-card" aria-label="앱 설치 안내"><InstallPromptContent prompt={prompt} /></aside>;
}

const DESKTOP_APP_NAME: Record<DesktopApp, string> = { mac: '맥 앱', windows: '윈도우 앱' };
const DESKTOP_APP_OPEN: Record<DesktopApp, string> = { mac: MAC_APP_OPEN, windows: WINDOWS_APP_OPEN };

/** 윈도우 로고 모양. 아이콘 묶음에 없어 직접 그린다. */
function WindowsLogo({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" /></svg>;
}
function DesktopAppIcon({ app, size = 16 }: { app: DesktopApp; size?: number }) {
  return app === 'windows' ? <WindowsLogo size={size - 2} /> : <Apple size={size} aria-hidden="true" />;
}

/** 맥·윈도우 브라우저에서 연 FeedEx에서만 데스크톱 앱을 권한다. 앱 안에서는 이미 쓰고 있다. */
export function desktopAppOffered(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0): DesktopApp | null {
  if (inNativeApp()) return null;
  if (onMacBrowser(userAgent, touchPoints)) return 'mac';
  return onWindowsBrowser(userAgent) ? 'windows' : null;
}
export const macAppOffered = (userAgent?: string, touchPoints?: number) => desktopAppOffered(userAgent, touchPoints) === 'mac';
export const windowsAppOffered = (userAgent?: string, touchPoints?: number) => desktopAppOffered(userAgent, touchPoints) === 'windows';
/**
 * 앱 설치로 들어가는 곳은 위쪽 버튼 하나다. 브라우저 앱을 이미 설치했어도 맥·윈도우에서는 데스크톱 앱을 받을 수 있게 남긴다.
 * 아무것도 권할 게 없으면 null이다.
 */
export function installEntry(state: ReturnType<typeof useInstallState>, target: ReturnType<typeof platform>, desktop: DesktopApp | null, iosSafari: boolean): string | null {
  if (state === 'installed') return desktop ? `${DESKTOP_APP_NAME[desktop]} 받기` : null;
  return target === 'ios' ? iosSafari ? '홈 화면 추가 안내' : '사파리로 열기' : '앱 설치';
}

/** 앱이 열리지 않으면 설치 안내 창을 열고, 앱이 없는 것 같다고 알린다. */
const showMissingApp = (app: DesktopApp) => window.dispatchEvent(new CustomEvent('sfeed:install', { detail: { missingApp: app } }));

/**
 * 데스크톱 앱 열기. 앱이 없을 때 아무 반응이 없지 않게, 열리지 않으면 onMissing으로 설치를 안내한다.
 * 주소는 링크에도 남겨 두어 새 탭 열기 등에서도 같은 앱 주소를 쓴다.
 */
function OpenDesktopApp({ app, onMissing, className, size = 16 }: { app: DesktopApp; onMissing: () => void; className: string; size?: number }) {
  const address = DESKTOP_APP_OPEN[app];
  return <a href={address} onClick={(event) => { event.preventDefault(); launchDesktopApp(app, address, onMissing); }} className={className}><DesktopAppIcon app={app} size={size} />{DESKTOP_APP_NAME[app]}으로 열기</a>;
}

export function InstallAppButton({ row = false }: { row?: boolean }) {
  const state = useInstallState();
  const desktop = desktopAppOffered();
  // 이 브라우저에서 앱이 열린 적이 있을 때만 '앱으로 열기'를 앞에 둔다. 아직이면 설치 안내로 들어간다.
  const known = useKnownDesktopApp(desktop);
  const label = installEntry(state, platform(), desktop, typeof navigator !== 'undefined' && isIOSSafari(navigator));
  if (!label) return null;
  const opener = desktop && known ? desktop : null;
  const name = opener && DESKTOP_APP_NAME[opener];
  // 휴대폰 설정 안에서는 다른 설정 줄과 같은 모양으로 둔다.
  if (row && !opener) return <button type="button" className="feedex-setting-action" onClick={() => openInstallHelp()}><Download size={17} aria-hidden="true" /><span>{label}</span><ChevronRight size={16} aria-hidden="true" /></button>;
  return <div className="flex items-center gap-1">
    {opener && <OpenDesktopApp app={opener} onMissing={() => showMissingApp(opener)} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400" />}
    <button type="button" onClick={() => openInstallHelp()} aria-label={name ? `${name} 설치 안내` : label} title={name ? `${name} 설치 안내` : undefined} className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-emerald-500 hover:bg-emerald-500/10 cursor-pointer"><Download size={16} aria-hidden="true" />{!name && label}</button>
  </div>;
}

/** 안내 창의 앱 한 칸. 아이콘과 이름을 왼쪽에, 주요 단추를 오른쪽에 둔다. */
function OptionTitle({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3">
    <span className="flex min-w-0 items-center gap-2.5"><span className="feedex-install-icon">{icon}</span><strong className="text-sm">{title}</strong></span>
    {children}
  </div>;
}

/** 이 브라우저에서 열린 적이 있으면 '열기'를, 아직이면 '받기'를 앞에 둔다. */
function openButtonClass(known: boolean) {
  return known
    ? 'mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950'
    : 'mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-500 px-4 py-2 text-sm font-bold text-emerald-500 hover:bg-emerald-500/10';
}

/** 맥이면 안내 창 맨 위에 맥 앱을 둔다. 웹 보기에서 언론사 로그인이 유지되는 것은 데스크톱 앱뿐이다. */
function MacAppOption({ known, onMissing }: { known: boolean; onMissing: () => void }) {
  return <section className="feedex-install-app" aria-label="맥 앱">
    <OptionTitle icon={<Apple size={18} aria-hidden="true" />} title="맥 앱"><a href={MAC_APP_DOWNLOAD} download="FeedEx-for-Mac.zip" className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950">받기</a></OptionTitle>
    <p className="mt-2 text-xs leading-5">웹 보기에서 언론사 로그인이 유지되는 맥 앱이에요. 설치되어 있다면 바로 열 수 있어요. 열리지 않으면 최신 맥 앱을 받아 교체해 주세요.</p>
    <OpenDesktopApp app="mac" onMissing={onMissing} size={15} className={openButtonClass(known)} />
    {/* Apple 서명이 없어 처음 한 번은 macOS가 막는다. '그래도 열기'는 한 번 열어 본 뒤에만 보이므로 순서대로 안내한다. */}
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5">
      <li>받은 zip을 풀어 feedex를 응용 프로그램 폴더에 넣어요.</li>
      <li>feedex를 한 번 열어요. 경고가 뜨면 '완료'를 눌러요.</li>
      <li>아래 버튼으로 시스템 설정을 열고 '그래도 열기'를 누르면 다음부터 바로 열려요.</li>
    </ol>
    <a href={MAC_SECURITY_SETTINGS} className="mt-3 inline-flex rounded-xl border border-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/10">시스템 설정 열기</a>
  </section>;
}

/** 윈도우면 안내 창 맨 위에 윈도우 앱을 둔다. 처음 켜면 '윈도우 앱으로 열기' 주소가 등록된다. */
function WindowsAppOption({ known, onMissing }: { known: boolean; onMissing: () => void }) {
  return <section className="feedex-install-app" aria-label="윈도우 앱">
    <OptionTitle icon={<WindowsLogo size={16} />} title="윈도우 앱"><a href={WINDOWS_APP_DOWNLOAD} download="FeedEx-for-Windows.zip" className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950">받기</a></OptionTitle>
    <p className="mt-2 text-xs leading-5">웹 보기에서 언론사 로그인이 유지되는 윈도우 앱이에요. 설치되어 있다면 바로 열 수 있어요.</p>
    <OpenDesktopApp app="windows" onMissing={onMissing} size={15} className={openButtonClass(known)} />
    {/* 코드 서명이 없어 처음 한 번은 SmartScreen이 막는다. '추가 정보'를 눌러야 '실행' 단추가 보인다. */}
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-5">
      <li>받은 zip을 마우스 오른쪽 단추로 눌러 '모두 압축 풀기'를 해요.</li>
      <li>풀린 FeedEx 폴더의 FeedEx.exe를 열어요. 'Windows의 PC 보호'가 뜨면 '추가 정보' → '실행'을 눌러요.</li>
      <li>작업 표시줄의 feedex를 마우스 오른쪽 단추로 눌러 '작업 표시줄에 고정'을 하면 다음부터 바로 열 수 있어요.</li>
    </ol>
  </section>;
}

/** 데스크톱 브라우저 앱(크롬·엣지 앱, Safari의 Dock 앱). 설치 단추나 한 줄 안내만 둔다. */
function BrowserAppOption({ target, nativePrompt, onInstall }: { target: ReturnType<typeof platform>; nativePrompt: boolean; onInstall: () => void }) {
  const hint = nativePrompt ? '주소창 없이 창으로 열어요' : target === 'mac-safari' ? "메뉴 막대의 '파일 → Dock에 추가…'로 설치해요" : '주소창 오른쪽의 설치 아이콘으로 설치해요';
  const icon = target === 'mac-safari' ? <Compass size={18} aria-hidden="true" /> : <Chrome size={18} aria-hidden="true" />;
  return <section className="feedex-install-app" aria-label="브라우저 앱">
    <OptionTitle icon={icon} title="브라우저 앱">
      {nativePrompt && <button type="button" onClick={onInstall} className="shrink-0 rounded-xl border border-emerald-500 px-4 py-2 text-sm font-bold text-emerald-500 hover:bg-emerald-500/10 cursor-pointer">설치</button>}
    </OptionTitle>
    <p className="mt-1 pl-[42px] text-xs leading-5">{hint}</p>
  </section>;
}

/**
 * 아이폰 설치 안내. MUUSED와 같은 방식이다. 단계는 손이 할 일만 남기고 화면의 아이콘 모양을 같이 그려
 * 눈으로 찾게 한다. 예외는 아래 한 줄로 뺀다. 이미 사파리라면 주소를 다시 열라고 하지 않는다.
 * 다른 아이폰 브라우저는 사파리로 넘겨 주고, 넘어가지 못했을 때만 주소 칸을 보여 준다.
 */
function IOSInstallSteps({ needsSafari, address, addressInput, copyStatus, onCopy }: { needsSafari: boolean; address: string; addressInput: RefObject<HTMLInputElement | null>; copyStatus: string; onCopy: () => void }) {
  const share = <Share size={15} aria-label="공유" className="inline-block align-[-2px] mx-0.5" />;
  const addHome = <SquarePlus size={15} aria-label="홈 화면에 추가" className="inline-block align-[-2px] mx-0.5" />;
  const steps = needsSafari
    ? [<>아래 <strong>사파리로 열기</strong></>, <>사파리에서 공유 {share} → {addHome} <strong>홈 화면에 추가</strong></>, <>홈 화면의 <strong>feedex</strong> 열기</>]
    : [<>아래 공유 단추 {share}</>, <>내려서 {addHome} <strong>홈 화면에 추가</strong></>, <><strong>추가</strong> 누르고 홈 화면의 <strong>feedex</strong> 열기</>];
  return <>
    <p className="text-sm font-bold leading-6 mb-3">아이폰은 홈 화면에 추가하면 앱처럼 열려요</p>
    <ol className="space-y-2.5 text-sm leading-6">{steps.map((step, index) => <li key={index}>{index + 1}. {step}</li>)}</ol>
    <p className="mt-4 text-xs leading-5 text-slate-400">{needsSafari
      ? '누르면 주소를 복사해 두니, 사파리가 열리지 않으면 주소창에 붙여넣으세요.'
      : <>'홈 화면에 추가'가 안 보이면 목록 맨 아래 <strong>동작 편집</strong>에서 켜세요. 주소창을 위에 두셨다면 공유 단추도 오른쪽 위에 있어요.</>} 홈 화면 앱에서는 로그인이 한 번 더 필요할 수 있어요.</p>
    {needsSafari && <button type="button" onClick={openInstallHelp} className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950">사파리로 열기</button>}
    {needsSafari && copyStatus && <div className="feedex-install-address mt-4"><label htmlFor="feedex-install-address">사파리에 붙여넣을 주소</label><div><input id="feedex-install-address" ref={addressInput} readOnly value={address} onFocus={(event) => event.target.select()} /><button type="button" onClick={onCopy}><Copy size={16} />주소 복사</button></div><p role="status">{copyStatus}</p></div>}
  </>;
}

export function PwaInstall() {
  const state = useInstallState();
  const target = platform();
  const ios = target === 'ios';
  const needsSafari = ios && !isIOSSafari(navigator);
  const prompt = useInstallPrompt();
  const desktop = desktopAppOffered();
  const known = useKnownDesktopApp(desktop);
  // 앱을 열려고 했는데 열리지 않았을 때. 안내 창 맨 위에 설치하라고 알린다.
  const [missing, setMissing] = useState<DesktopApp | null>(null);
  // 브라우저 앱을 이미 설치한 맥·윈도우에서는 데스크톱 앱만 안내한다.
  const browserSteps = state !== 'installed';
  const mobile = ios || target === 'android';
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const address = typeof window !== 'undefined' && window.location ? installAddress(window.location.href) : '';
  useEffect(() => { const show = (event: Event) => { const status = (event as CustomEvent<{ safariFailed?: boolean; copied?: boolean; missingApp?: DesktopApp }>).detail; setMissing(status?.missingApp ?? null); setCopyStatus(status?.safariFailed ? status.copied ? '주소를 복사했어요 · 사파리에 붙여넣으세요' : '주소를 복사해 사파리에서 열어 주세요' : ''); setOpen(true); }; window.addEventListener('sfeed:install', show); return () => window.removeEventListener('sfeed:install', show); }, []);
  useEffect(() => { if (open) { dialog.current?.showModal(); closeButton.current?.focus(); } else dialog.current?.close(); }, [open]);
  useEffect(() => { if (state === 'installed' && !desktop) setOpen(false); }, [state, desktop]);
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(address); setCopyStatus('주소를 복사했어요 · 사파리에 붙여넣으세요'); }
    catch { addressInput.current?.focus(); addressInput.current?.select(); setCopyStatus('주소를 길게 눌러 복사한 뒤 사파리에서 열어 주세요'); }
  };
  return <>
    <dialog ref={dialog} aria-labelledby="install-title" className="feedex-install-dialog" onCancel={() => setOpen(false)} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === dialog.current) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setOpen(false); } }}>
      <div className="flex items-center gap-3 mb-5"><img src="/icons/icon-192.png" alt="" width="44" height="44" /><h2 id="install-title" className="text-xl font-bold">{ios ? '홈 화면에 추가하는 법' : browserSteps || !desktop ? 'feedex 앱 설치' : `${DESKTOP_APP_NAME[desktop]} 받기`}</h2></div>
      {missing && <p role="status" className="feedex-install-notice">{DESKTOP_APP_NAME[missing]}이 열리지 않았어요. 아직 설치하지 않았다면 아래에서 받아 설치해 주세요.</p>}
      {desktop === 'mac' && <MacAppOption known={known} onMissing={() => setMissing('mac')} />}
      {desktop === 'windows' && <WindowsAppOption known={known} onMissing={() => setMissing('windows')} />}
      {browserSteps && !mobile && <div className={desktop ? 'mt-3' : ''}><BrowserAppOption target={target} nativePrompt={prompt.nativePrompt} onInstall={() => { void prompt.act(); }} /></div>}
      {browserSteps && mobile && (ios ? <IOSInstallSteps needsSafari={needsSafari} address={address} addressInput={addressInput} copyStatus={copyStatus} onCopy={() => { void copyAddress(); }} /> : <>
      <p className="text-sm text-slate-400 leading-6 mb-5">홈 화면에서 브라우저 주소창 없이 feedex를 열 수 있어요.</p>
      <ol className="list-decimal pl-5 space-y-3 text-sm leading-6"><li>브라우저 메뉴 <strong>⋮</strong>를 누르세요.</li><li><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</li><li>설치 버튼이 보이면 눌러 완료하세요.</li></ol>
      </>)}
      <div className="flex justify-end gap-2 mt-6">{mobile && prompt.nativePrompt && <button type="button" onClick={() => { void prompt.act(); }} className="rounded-xl border border-emerald-500 text-emerald-400 px-5 py-2.5 text-sm font-bold cursor-pointer">지금 설치</button>}<button ref={closeButton} type="button" onClick={() => setOpen(false)} className="rounded-xl bg-emerald-500 text-slate-950 px-5 py-2.5 text-sm font-bold cursor-pointer">닫기</button></div>
    </dialog>
  </>;
}
