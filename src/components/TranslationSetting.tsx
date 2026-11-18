import { useEffect, useRef, useState } from 'react';
import { Languages, Trash2 } from 'lucide-react';
import { apiRequest } from '../client/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingLabel } from './SettingLabel';

export interface TranslationConfig {
  canManage: boolean;
  provider?: 'deepl' | 'workers-ai';
  /** 저장된(또는 서버가 관리하는) DeepL 키가 있는지. 키가 있어도 Workers AI를 고를 수 있다. */
  keySaved?: boolean;
  managed?: boolean;
  usage?: { used: number; limit: number } | null;
  problem?: string | null;
  storage?: boolean;
  personal?: { deepl: boolean; workersAi: boolean; storage: boolean };
}

// 사용량은 '4.8만 / 100만자'처럼 짧게 적는다.
const COMPACT = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const count = (value: number) => COMPACT.format(value);

/**
 * 일반 사용자는 개인 서비스를 연결하고, 운영자는 기존 서버 설정을 사용한다.
 * 키는 서버에 암호화해 저장하고 화면에는 다시 보여 주지 않는다.
 */
export function TranslationSetting({ initial }: { initial?: TranslationConfig }) {
  const [config, setConfig] = useState<TranslationConfig | null>(initial ?? null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  // 설정 창을 처음 열 때 한 번만 읽는다. 운영자면 DeepL 사용량도 함께 묻기 때문이다.
  useEffect(() => {
    if (initial) return;
    let active = true, loaded = false;
    const panel = probe.current?.closest('details');
    const load = () => {
      if (loaded || (panel && !panel.open)) return;
      loaded = true;
      apiRequest<TranslationConfig>('/api/translation/config').then((value) => { if (active) setConfig(value); }).catch(() => {});
    };
    load();
    panel?.addEventListener('toggle', load);
    return () => { active = false; panel?.removeEventListener('toggle', load); };
  }, [initial]);
  if (!config) return <span ref={probe} hidden />;
  if (config.personal) return <PersonalArticleTools initial={config.personal} />;
  if (!config.canManage) return null;
  const deepl = config.provider === 'deepl';
  const keySaved = config.keySaved ?? deepl;
  const run = async (request: () => Promise<TranslationConfig>, done: string) => {
    setBusy(true); setMessage('');
    try { setConfig(await request()); setKey(''); setMessage(done); }
    catch (error) { setMessage(error instanceof Error && error.message ? error.message : '저장하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const choose = (provider: 'deepl' | 'workers-ai') => run(() => apiRequest<TranslationConfig>('/api/translation/provider', { method: 'PUT', body: JSON.stringify({ provider }) }), provider === 'deepl' ? 'DeepL로 번역해요.' : 'Workers AI로 번역해요. 키는 그대로 저장돼 있어요.');
  // 사용량은 DeepL일 때 보인다. 키가 막히면 Workers AI로 넘어간다는 설명은 마우스를 올렸을 때만 보인다.
  const usage = keySaved ? config.problem ?? (config.usage ? `이번 달 ${count(config.usage.used)} / ${count(config.usage.limit)}자 사용` : '') : '';
  const removable = deepl && keySaved && !config.managed;
  const hint = !keySaved ? 'DeepL API 키를 넣으면 DeepL로 번역해요'
    : config.managed ? 'DeepL API 키는 서버에서 관리 중이에요. 한도를 넘으면 Workers AI로 번역해요.'
    : 'DeepL 키가 저장돼 있어요. 한도를 넘거나 키가 막히면 Workers AI로 번역해요.';
  return <div className="feedex-translation-setting">
    <div className="feedex-auto-refresh-setting" title={hint}>
      <SettingLabel icon={Languages}>번역{deepl && usage && <small>{usage}</small>}</SettingLabel>
      <div className="feedex-cache-controls">
        {/* 키는 저장해 둔 채 서비스만 바꾼다. 키가 없을 때 DeepL을 고르면 키 입력칸으로 간다. */}
        <select aria-label="번역 서비스" value={deepl ? 'deepl' : 'workers-ai'} disabled={busy} onChange={(event) => {
          if (event.target.value === 'deepl' && !keySaved) { keyInput.current?.focus(); return; }
          void choose(event.target.value === 'deepl' ? 'deepl' : 'workers-ai');
        }}>
          <option value="deepl">DeepL</option>
          <option value="workers-ai">Workers AI</option>
        </select>
        {removable && <button type="button" className="feedex-icon-danger" aria-label="DeepL 키 지우기" disabled={busy || confirm} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>}
      </div>
    </div>
    {confirm && <ConfirmDialog title="DeepL 키 지우기" confirmLabel="지우기" busyLabel="지우는 중…" tone="danger" isDark={document.documentElement.classList.contains('dark')} busy={busy} error={null}
      onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'DELETE' }), 'DeepL 키를 지웠어요.'); }}>
      저장된 DeepL API 키를 지울까요? 지우면 다시 키를 넣어야 DeepL을 쓸 수 있어요.
    </ConfirmDialog>}
    {!keySaved && !config.managed && <form className="feedex-translation-key" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (key.trim()) void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'PUT', body: JSON.stringify({ key: key.trim() }) }), 'DeepL 키를 저장했어요.'); }}>
      <input ref={keyInput} type="password" aria-label="DeepL API 키" placeholder="DeepL API 키" value={key} maxLength={120} disabled={busy || config.storage === false} autoComplete="new-password" spellCheck={false} onChange={(event) => setKey(event.target.value)} />
      <button type="submit" className="feedex-cache-clear" disabled={busy || !key.trim() || config.storage === false}>저장</button>
    </form>}
    {!keySaved && !config.managed && <p className="feedex-setting-message">{config.storage === false ? '서버에 키 저장 준비가 안 돼 있어요.' : 'DeepL 계정의 API Keys에서 복사해요. 앱 구독과는 별개예요.'}</p>}
    {message && <p className="feedex-setting-message" role="status">{message}</p>}
  </div>;
}

function PersonalArticleTools({ initial }: { initial: NonNullable<TranslationConfig['personal']> }) {
  const [config, setConfig] = useState(initial);
  const [accountId, setAccountId] = useState(''), [token, setToken] = useState(''), [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const change = async (service: 'deepl' | 'workers-ai', connect: boolean) => {
    setBusy(true); setMessage('');
    try {
      const response = await apiRequest<TranslationConfig>(`/api/translation/account/${service}`, connect
        ? { method: 'PUT', body: JSON.stringify(service === 'deepl' ? { key } : { accountId, token }) }
        : { method: 'DELETE' });
      if (response.personal) setConfig(response.personal);
      if (service === 'deepl') setKey('');
      else { setAccountId(''); setToken(''); }
      setMessage(connect ? '개인 연결을 저장했어요.' : '개인 연결을 해제했어요.');
    } catch (error) { setMessage(error instanceof Error ? error.message : '설정을 저장하지 못했어요.'); }
    finally { setBusy(false); }
  };
  return <div className="feedex-translation-setting">
    <p className="feedex-setting-message">내 API 계정의 사용량으로 처리해요. Workers AI는 요약과 번역, DeepL은 번역에 쓰여요.</p>
    {!config.storage && <p className="feedex-setting-message" role="status">서버에 개인 API 키를 저장할 준비가 되지 않았어요.</p>}
    <div className="feedex-auto-refresh-setting">
      <SettingLabel icon={Languages}>Workers AI <small>{config.workersAi ? '저장됨' : '요약·번역'}</small></SettingLabel>
      {config.workersAi && <button type="button" className="feedex-cache-clear" aria-label="Workers AI 연결 해제" disabled={busy} onClick={() => void change('workers-ai', false)}>연결 해제</button>}
    </div>
    {!config.workersAi && <form className="feedex-personal-key-form" autoComplete="off" onSubmit={event => { event.preventDefault(); if (accountId.trim() && token.trim()) void change('workers-ai', true); }}>
      <div className="feedex-translation-key"><input type="text" aria-label="Cloudflare 계정 ID" placeholder="Cloudflare 계정 ID" value={accountId} maxLength={32} disabled={busy || !config.storage} autoComplete="off" spellCheck={false} onChange={event => setAccountId(event.target.value)} /></div>
      <div className="feedex-translation-key"><input type="password" aria-label="Workers AI API 토큰" placeholder="Workers AI API 토큰" value={token} maxLength={128} disabled={busy || !config.storage} autoComplete="new-password" spellCheck={false} onChange={event => setToken(event.target.value)} />
        <button type="submit" className="feedex-cache-clear" disabled={busy || !config.storage || !accountId.trim() || !token.trim()}>저장</button></div>
      <a className="feedex-setting-message underline" href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noopener noreferrer">Workers AI API 토큰 발급 방법</a>
    </form>}
    <div className="feedex-auto-refresh-setting">
      <SettingLabel icon={Languages}>DeepL <small>{config.deepl ? '연결됨 · 번역에 우선 사용' : '번역 · 선택 사항'}</small></SettingLabel>
      {config.deepl && <button type="button" className="feedex-cache-clear" aria-label="DeepL 연결 해제" disabled={busy} onClick={() => void change('deepl', false)}>연결 해제</button>}
    </div>
    {!config.deepl && <form className="feedex-translation-key" autoComplete="off" onSubmit={event => { event.preventDefault(); if (key.trim()) void change('deepl', true); }}>
      <input type="password" aria-label="DeepL API 키" placeholder="DeepL API 키" value={key} maxLength={120} disabled={busy || !config.storage} autoComplete="new-password" spellCheck={false} onChange={event => setKey(event.target.value)} />
      <button type="submit" className="feedex-cache-clear" disabled={busy || !config.storage || !key.trim()}>저장</button>
    </form>}
    {message && <p className="feedex-setting-message" role="status">{message}</p>}
  </div>;
}
