import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { apiRequest } from '../client/api';
import { X_SETUP_LOGIN_URL, type XConfig } from '../client/xConnection';

interface Props {
  config: XConfig;
  isDark: boolean;
  onBusyChange: (value: boolean) => void;
  onConfigured: (config: XConfig) => void;
}

export function XConnectionSetup({ config, isDark, onBusyChange, onConfigured }: Props) {
  const [clientId, setClientId] = useState(''), [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [copied, setCopied] = useState(false);
  const field = `w-full rounded-xl border px-3 py-2.5 text-sm ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-300'}`;

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); onBusyChange(true); setError(null);
    let result: XConfig | undefined;
    try {
      result = await apiRequest<XConfig>('/api/x/settings', { method: 'PUT', body: JSON.stringify({ clientId, clientSecret }) });
      setClientSecret(''); setClientId('');
    } catch (err) { setError(err instanceof Error ? err.message : '연결 정보를 저장하지 못했습니다.'); }
    finally { setSaving(false); onBusyChange(false); }
    if (result) onConfigured(result);
  }

  return <section aria-label="X 최초 연결 설정" className={`rounded-2xl border p-4 space-y-4 ${isDark ? 'border-slate-700 bg-slate-900/60' : 'border-slate-200 bg-white'}`}>
    <div><h4 className="text-sm font-bold">처음 한 번만 연결 설정</h4><p className="mt-1 text-xs leading-relaxed text-slate-400">SFeed에서 X 로그인을 사용하려면 X 앱을 한 번 등록해야 합니다. 설정을 마치면 다음부터는 로그인 버튼으로 바로 연결됩니다.</p></div>
    <ol className="space-y-4 text-xs leading-relaxed">
      <li><strong className="block mb-2">1. X에 로그인하기</strong><a href={X_SETUP_LOGIN_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 px-3 py-2 text-emerald-500 font-semibold">X 로그인 창 열기<ExternalLink className="w-3.5 h-3.5" /></a><p className="mt-2 text-slate-400">로그인 후 X 개발자 콘솔로 이동합니다. 이 SFeed 화면은 그대로 두세요.</p></li>
      <li><strong className="block mb-2">2. SFeed 앱 등록하기</strong><p className="text-slate-400">앱 이름은 SFeed, 앱 유형은 Web App으로 선택하고 OAuth 2.0을 켜세요. Website URL에는 {new URL(config.redirectUri).origin}을 입력하세요.</p>
        <label className="block mt-3 space-y-1.5"><span>돌아올 주소 (Callback URI)</span><input readOnly aria-label="X Callback URI" value={config.redirectUri} onFocus={(event) => event.target.select()} className={`${field} font-mono text-xs`} /></label>
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(config.redirectUri); setCopied(true); } catch { setError('주소를 길게 누르거나 선택해서 복사해 주세요.'); } }} className="mt-2 inline-flex items-center gap-1 text-emerald-500 cursor-pointer">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '주소 복사됨' : '주소 복사'}</button>
      </li>
      <li><strong className="block mb-2">3. 발급된 연결 정보 저장하기</strong><p className="text-slate-400">X 앱의 Keys and tokens에서 발급받은 OAuth 2.0 Client ID와 Client Secret을 입력하세요. X 계정 비밀번호를 입력하는 곳이 아닙니다.</p></li>
    </ol>
    <form onSubmit={save} className="space-y-3" autoComplete="off">
      <label className="block space-y-1.5 text-xs"><span>Client ID</span><input required value={clientId} maxLength={2048} disabled={saving} onChange={(event) => setClientId(event.target.value)} autoComplete="off" spellCheck={false} className={field} /></label>
      <label className="block space-y-1.5 text-xs"><span>Client Secret</span><input required type="password" value={clientSecret} maxLength={2048} disabled={saving} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" spellCheck={false} className={field} /></label>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
      <button type="submit" disabled={saving || !clientId.trim() || !clientSecret.trim()} className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-slate-950 text-sm font-bold cursor-pointer disabled:opacity-40 inline-flex items-center justify-center gap-2">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{saving ? '연결 정보 저장 중…' : '저장하고 X 계정 연결'}</button>
      <p className="text-[11px] text-slate-400">연결 정보는 암호화해 저장하며 운영자만 변경할 수 있습니다. X API 이용 권한·잔액은 X 개발자 콘솔에서 확인하세요.</p>
    </form>
  </section>;
}
