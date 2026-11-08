import { useEffect, useState } from 'react';
import { apiRequest } from '../client/api';
import { nativeAppName, nativeSignInCallback, nativeSignInPlatform, nativeSignInState } from '../client/nativeApp';
import { rememberDesktopApp } from '../client/desktopApp';

/**
 * 데스크톱 앱이 연 시스템 로그인 창(맥은 Safari, 윈도우는 기본 브라우저)에서 보이는 화면. 로그인한 계정을 보여 주고,
 * 누르면 1분짜리 일회용 코드를 받아 앱으로 돌려보낸다. 다른 계정이 로그인돼 있을 수 있어 바로 넘기지 않고 한 번 확인한다.
 * 윈도우 앱은 로그인을 시작할 때 붙인 상태 값이 함께 돌아와야 코드를 받는다.
 */
export function NativeHandoff({ email, isDark, onUseAnother }: { email: string; isDark: boolean; onUseAnother: () => void }) {
  const [state, setState] = useState<'ready' | 'sending' | 'sent' | 'failed'>('ready');
  const name = nativeAppName(nativeSignInPlatform());
  // 앱이 이 브라우저로 로그인 창을 열었으니 이 컴퓨터에는 앱이 있다. 다음부터 위쪽에 '앱으로 열기'를 둔다.
  useEffect(() => { rememberDesktopApp(nativeSignInPlatform()); }, []);
  const send = async () => {
    setState('sending');
    try {
      const { code } = await apiRequest<{ code: string }>('/api/user/native-code', { method: 'POST' });
      setState('sent');
      window.location.href = nativeSignInCallback(code, nativeSignInState());
    } catch {
      setState('failed');
    }
  };
  return <main className={`min-h-screen flex items-center justify-center p-8 ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
    <div className="w-full max-w-sm space-y-5 text-center">
      <img src="/icons/icon-192.png" alt="" width="56" height="56" className="mx-auto rounded-2xl" />
      <h1 className="text-xl font-bold">FeedEx {name}에 로그인</h1>
      <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}><strong className={`break-all ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{email}</strong> 계정으로 {name}에 로그인할까요?</p>
      <button type="button" disabled={state === 'sending' || state === 'sent'} onClick={() => { void send(); }} className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 disabled:opacity-60 cursor-pointer">
        {state === 'sent' ? `${name}으로 돌아가는 중…` : state === 'sending' ? '준비하는 중…' : `${name}으로 로그인`}
      </button>
      <button type="button" disabled={state === 'sending' || state === 'sent'} onClick={onUseAnother} className={`w-full rounded-xl border px-4 py-3 text-sm disabled:opacity-60 cursor-pointer ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-900' : 'border-slate-300 text-slate-700 hover:bg-slate-100'}`}>다른 계정으로 로그인</button>
      {state === 'failed' && <p role="alert" className="text-xs text-rose-500">코드를 받지 못했어요. 다시 눌러 주세요.</p>}
    </div>
  </main>;
}
