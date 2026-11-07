import React, { useEffect, useRef, useState } from 'react';
import {
  Rss,
  Sparkles,
  BookOpen,
  Layers,
  FolderKanban,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest, setStoredToken, type UserProfile, type ThemeMode } from '../client/api';
import { inNativeApp, inNativeSignInWindow, nativeBridge } from '../client/nativeApp';
import { InstallAppButton } from './PwaInstall';
import { ThemeSwitch } from './ThemeSwitch';

interface LoginViewProps {
  onLoginSuccess: (user: UserProfile) => void;
  theme?: ThemeMode;
  onChangeTheme?: (theme: ThemeMode) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement | null,
            options: Record<string, unknown>
          ) => void;
          prompt: () => void;
        };
      };
    };
    /** 맥 앱이 시스템 로그인 창에서 받은 일회용 코드를 넘겨준다. */
    feedexNativeSignedIn?: (code: string) => Promise<void>;
  }
}

const DEFAULT_GOOGLE_CLIENT_ID =
  '649668487161-f4hutlff1sc7klvplnrm3dki5u3oh3ht.apps.googleusercontent.com';

const DEMO_GOOGLE_ACCOUNTS = [
  {
    name: '김태현 (Product Engineer)',
    email: 'taehyun.kim@gmail.com',
    role: '추천 피드를 직접 선택하는 개인 워크스페이스',
    picture: 'https://api.dicebear.com/9.x/glass/svg?seed=taehyun',
  },
  {
    name: '박서연 (AI Researcher)',
    email: 'seoyeon.ai@gmail.com',
    role: '별도 멀티유저 워크스페이스 계정',
    picture: 'https://api.dicebear.com/9.x/glass/svg?seed=seoyeon',
  },
];

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, theme = 'dark', onChangeTheme }) => {
  const [googleClientId, setGoogleClientId] = useState<string>(
    DEFAULT_GOOGLE_CLIENT_ID
  );
  // 서버가 빠른 로그인이 켜져 있다고 확인할 때까지 숨긴다 (로컬 개발 전용)
  const [quickLoginEnabled, setQuickLoginEnabled] = useState(false);
  const [customEmail, setCustomEmail] = useState('');
  const [customName, setCustomName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gsiBtnRef = useRef<HTMLDivElement>(null);
  // 맥 앱에서는 구글이 앱 안 로그인을 막으므로 시스템 로그인 창(Safari)에서 로그인한다.
  const native = inNativeApp();
  // 맥 앱 로그인을 넘겨주려고 시스템 로그인 창에서 연 화면이다.
  const handoff = inNativeSignInWindow();

  useEffect(() => {
    if (!native) return;
    window.feedexNativeSignedIn = async (code: string) => {
      setError(null);
      setLoading(true);
      try {
        const res = await apiRequest<{ token: string; user: UserProfile }>('/api/auth/native-code/redeem', { method: 'POST', body: JSON.stringify({ code }) });
        setStoredToken(res.token);
        onLoginSuccess(res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : '로그인하지 못했습니다. 다시 시도해 주세요.');
      } finally {
        setLoading(false);
      }
    };
    return () => { delete window.feedexNativeSignedIn; };
  }, [native, onLoginSuccess]);

  useEffect(() => {
    apiRequest<{ googleClientId: string | null; quickLoginEnabled?: boolean }>(
      '/api/auth/config'
    )
      .then((res) => {
        if (res.googleClientId) setGoogleClientId(res.googleClientId);
        setQuickLoginEnabled(res.quickLoginEnabled === true);
      })
      .catch(() => {});
  }, []);

  // 공식 Google Identity Services 버튼을 그린다 (MUUSED와 같은 방식)
  useEffect(() => {
    if (native) return;
    let attempts = 0;
    const tryInitGsi = () => {
      if (window.google?.accounts?.id && gsiBtnRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async (response: { credential: string }) => {
              setError(null);
              setLoading(true);
              try {
                const res = await apiRequest<{
                  token: string;
                  user: UserProfile;
                }>('/api/auth/google/credential', {
                  method: 'POST',
                  body: JSON.stringify({ credential: response.credential }),
                });
                setStoredToken(res.token);
                onLoginSuccess(res.user);
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : 'Google 인증 확인에 실패했습니다.'
                );
              } finally {
                setLoading(false);
              }
            },
          });

          gsiBtnRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(gsiBtnRef.current, {
            theme: 'filled_black',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
            locale: 'ko',
            width: Math.max(200, Math.min(340, (gsiBtnRef.current.parentElement?.clientWidth || 372) - 34)),
          });
        } catch {
          // 오프라인이라 막히면 무시한다
        }
        return;
      }
      if (attempts < 20) {
        attempts++;
        setTimeout(tryInitGsi, 250);
      }
    };

    tryInitGsi();
  }, [googleClientId, onLoginSuccess, native]);

  const handleQuickGoogleSignIn = async (
    email: string,
    name: string,
    picture?: string
  ) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: UserProfile }>(
        '/api/auth/google/quick',
        {
          method: 'POST',
          body: JSON.stringify({ email, name, picture }),
        }
      );
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customEmail.trim()) return;
    const email = customEmail.includes('@')
      ? customEmail.trim()
      : `${customEmail.trim()}@gmail.com`;
    const name = customName.trim() || email.split('@')[0];
    handleQuickGoogleSignIn(email, name);
  };

  return (
    <div className="feedex-login min-h-screen bg-slate-950 text-slate-100 flex flex-col lg:flex-row">
      {/* 왼쪽 소개 영역 */}
      <div className="lg:w-7/12 p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/30">
        <div className="relative z-10">
          {onChangeTheme && <div className="flex justify-end mb-4"><ThemeSwitch theme={theme} onChange={onChangeTheme} /></div>}
          <div className="inline-flex items-center gap-3 mb-10">
            <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Rss className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-2xl font-bold tracking-tight text-white">
                FeedEx
              </span>
              <span className="ml-2 text-xs font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Cloudflare Edge RSS
              </span>
            </div>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight mb-6">
            쏟아지는 기술과 뉴스를
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
              가장 빠르고 스마트하게
            </span>{' '}
            읽다
          </h1>
          <p className="text-slate-400 text-base sm:text-lg max-w-xl leading-relaxed mb-10">
            Feedly 스타일의 직관적인 3가지 레이아웃, 광고 없는 원문 스크래핑(Reader
            View), 그리고 Cloudflare Workers AI 기반 한국어 3줄 핵심 요약까지 결합된
            멀티유저 RSS 큐레이션 플랫폼입니다.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">
                  Cloudflare Workers AI 요약
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  긴 영문·기술 아티클도 클릭 한 번으로 핵심 요약과 주요 포인트를 한국어로
                  즉시 정리합니다.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">
                  원문 전체 스크래핑 (Reader View)
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  요약본만 제공하는 RSS 피드도 원문 웹페이지 본문을 추출해 쾌적한 리더
                  뷰로 보여줍니다.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">
                  매거진 · 카드 · 리스트 3종 뷰
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  취향에 따라 레이아웃과 다크/라이트 모드를 전환하고 단축키(↑/↓/M/S)로
                  빠르게 탐색하세요.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/90 flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 shrink-0">
                <FolderKanban className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-white text-sm mb-1">
                  폴더 분류 & OPML 마이그레이션
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  카테고리별 폴더 정리와 OPML 파일 가져오기/내보내기로 기존 Feedly 구독을
                  그대로 이전합니다.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-10 pt-6 border-t border-slate-800/70 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Powered by React 19 · Hono · Cloudflare D1 · Workers AI</span>
          </div>
          <span>GitHub + Cloudflare 자동 배포 아키텍처</span>
          <InstallAppButton />
          <a href="/privacy" className="hover:text-slate-300 hover:underline underline-offset-2">
            개인정보처리방침
          </a>
        </div>
      </div>

      {/* 오른쪽 로그인 영역 */}
      <div className="lg:w-5/12 p-8 lg:p-14 flex items-center justify-center bg-slate-950">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">
              Google 계정으로 시작하기
            </h2>
            <p className="text-sm text-slate-400">
              구글 계정으로 로그인하면 내 폴더, 구독 피드, 북마크(Read Later)가 기기
              사이에서 동기화됩니다.
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 leading-relaxed">
              {error}
            </div>
          )}

          {handoff && (
            <p className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 leading-relaxed">
              FeedEx for Mac에서 쓸 계정으로 로그인하세요. 로그인하면 맥 앱으로 돌아갑니다.
            </p>
          )}

          {native ? (
            <div className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-slate-900/70 border border-slate-800">
              <button type="button" disabled={loading} onClick={() => { setError(null); nativeBridge()?.postMessage({ type: 'signIn' }); }} className="w-full max-w-[340px] min-h-[44px] rounded-full bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 disabled:opacity-60 cursor-pointer">
                {loading ? '로그인하는 중…' : 'Google 계정으로 로그인'}
              </button>
              <span className="text-[11px] text-slate-400 text-center leading-relaxed">
                시스템 로그인 창(Safari)에서 로그인하면 이 앱으로 돌아와요.
              </span>
            </div>
          ) : (
          /* 공식 Google GIS 버튼 자리 (MUUSED 방식) */
          <div className="flex flex-col items-center gap-3 p-4 rounded-2xl bg-slate-900/70 border border-slate-800">
            <div ref={gsiBtnRef} className="min-h-[44px] flex items-center justify-center" />
            <span className="text-[11px] text-slate-400">
              Google Identity Services (RS256 서명 검증 · D1 세션 동기화)
            </span>
          </div>
          )}

          {quickLoginEnabled && (
            <>
              {/* 여러 사용자 빠른 전환 (로컬 개발 전용) */}
              <div className="pt-1">
                <div className="relative flex py-2 items-center">
                  <div className="flex-grow border-t border-slate-800"></div>
                  <span className="flex-shrink mx-3 text-xs text-slate-500 font-medium">
                    로컬 개발용 빠른 계정 전환
                  </span>
                  <div className="flex-grow border-t border-slate-800"></div>
                </div>

                <div className="space-y-2.5 mt-3">
                  {DEMO_GOOGLE_ACCOUNTS.map((acct) => (
                    <button
                      key={acct.email}
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        handleQuickGoogleSignIn(acct.email, acct.name, acct.picture)
                      }
                      className="w-full p-3 rounded-xl bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/40 flex items-center justify-between text-left transition group cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={acct.picture}
                          alt={acct.name}
                          className="w-9 h-9 rounded-full bg-slate-800 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-100 group-hover:text-emerald-300 transition truncate">
                            {acct.name}
                          </div>
                          <div className="text-xs text-slate-400 truncate">
                            {acct.email} · {acct.role}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition shrink-0" />
                    </button>
                  ))}
                </div>
              </div>

              {/* 직접 입력하는 Google 계정 양식 */}
              <form
                onSubmit={handleCustomSubmit}
                className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3"
              >
                <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>이메일로 즉시 워크스페이스 시작</span>
                  <span className="text-[11px] text-emerald-400 font-normal">
                    원하는 추천 피드만 선택해 구독
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    placeholder="이름 (예: 홍길동)"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <input
                    type="email"
                    placeholder="이메일 (user@gmail.com)"
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    required
                    className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !customEmail.trim()}
                  className="w-full py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>이 계정으로 시작하기</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
