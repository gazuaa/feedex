import { useEffect, useRef, useState } from 'react';
import { Languages, Trash2 } from 'lucide-react';
import { apiRequest } from '../client/api';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingLabel } from './SettingLabel';
import { t, locale } from '../shared/i18n';

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
const COMPACT = new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 });
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
    catch (error) { setMessage(error instanceof Error && error.message ? error.message : t('저장하지 못했어요.', 'Could not save.')); }
    finally { setBusy(false); }
  };
  const choose = (provider: 'deepl' | 'workers-ai') => run(() => apiRequest<TranslationConfig>('/api/translation/provider', { method: 'PUT', body: JSON.stringify({ provider }) }), provider === 'deepl' ? t('DeepL로 번역해요.', 'Translating with DeepL.') : t('Workers AI로 번역해요. 키는 그대로 저장돼 있어요.', 'Translating with Workers AI. Your key stays saved.'));
  // 사용량은 DeepL일 때 보인다. 키가 막히면 Workers AI로 넘어간다는 설명은 마우스를 올렸을 때만 보인다.
  const usage = keySaved ? config.problem ?? (config.usage ? t(`이번 달 ${count(config.usage.used)} / ${count(config.usage.limit)}자 사용`, `${count(config.usage.used)} / ${count(config.usage.limit)} characters this month`) : '') : '';
  const removable = deepl && keySaved && !config.managed;
  const hint = !keySaved ? t('DeepL API 키를 넣으면 DeepL로 번역해요', 'Add a DeepL API key to translate with DeepL')
    : config.managed ? t('DeepL API 키는 서버에서 관리 중이에요. 한도를 넘으면 Workers AI로 번역해요.', 'The DeepL API key is managed on the server. Over the limit, Workers AI translates.')
    : t('DeepL 키가 저장돼 있어요. 한도를 넘거나 키가 막히면 Workers AI로 번역해요.', 'A DeepL key is saved. Over the limit or if the key is blocked, Workers AI translates.');
  return <div className="feedex-translation-setting">
    <div className="feedex-auto-refresh-setting" title={hint}>
      <SettingLabel icon={Languages}>{t('번역', 'Translation')}{deepl && usage && <small>{usage}</small>}</SettingLabel>
      <div className="feedex-cache-controls">
        {/* 키는 저장해 둔 채 서비스만 바꾼다. 키가 없을 때 DeepL을 고르면 키 입력칸으로 간다. */}
        <select aria-label={t('번역 서비스', 'Translation service')} value={deepl ? 'deepl' : 'workers-ai'} disabled={busy} onChange={(event) => {
          if (event.target.value === 'deepl' && !keySaved) { keyInput.current?.focus(); return; }
          void choose(event.target.value === 'deepl' ? 'deepl' : 'workers-ai');
        }}>
          <option value="deepl">DeepL</option>
          <option value="workers-ai">Workers AI</option>
        </select>
        {removable && <button type="button" className="feedex-icon-danger" aria-label={t('DeepL 키 지우기', 'Remove DeepL key')} disabled={busy || confirm} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>}
      </div>
    </div>
    {confirm && <ConfirmDialog title={t('DeepL 키 지우기', 'Remove DeepL key')} confirmLabel={t('지우기', 'Remove')} busyLabel={t('지우는 중…', 'Removing…')} tone="danger" isDark={document.documentElement.classList.contains('dark')} busy={busy} error={null}
      onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'DELETE' }), t('DeepL 키를 지웠어요.', 'DeepL key removed.')); }}>
      {t('저장된 DeepL API 키를 지울까요? 지우면 다시 키를 넣어야 DeepL을 쓸 수 있어요.', 'Remove the saved DeepL API key? You will need to add it again to use DeepL.')}
    </ConfirmDialog>}
    {!keySaved && !config.managed && <form className="feedex-translation-key" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (key.trim()) void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'PUT', body: JSON.stringify({ key: key.trim() }) }), t('DeepL 키를 저장했어요.', 'DeepL key saved.')); }}>
      <input ref={keyInput} type="password" aria-label={t('DeepL API 키', 'DeepL API key')} placeholder={t('DeepL API 키', 'DeepL API key')} value={key} maxLength={120} disabled={busy || config.storage === false} autoComplete="new-password" spellCheck={false} onChange={(event) => setKey(event.target.value)} />
      <button type="submit" className="feedex-cache-clear" disabled={busy || !key.trim() || config.storage === false}>{t('저장', 'Save')}</button>
    </form>}
    {!keySaved && !config.managed && <p className="feedex-setting-message">{config.storage === false ? t('서버에 키 저장 준비가 안 돼 있어요.', 'The server is not set up to store keys.') : t('DeepL 계정의 API Keys에서 복사해요. 앱 구독과는 별개예요.', 'Copy it from API Keys in your DeepL account. It is separate from the app subscription.')}</p>}
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
      setMessage(connect ? t('개인 연결을 저장했어요.', 'Your connection is saved.') : t('개인 연결을 해제했어요.', 'Disconnected.'));
    } catch (error) { setMessage(error instanceof Error ? error.message : t('설정을 저장하지 못했어요.', 'Could not save the setting.')); }
    finally { setBusy(false); }
  };
  return <div className="feedex-translation-setting">
    <p className="feedex-setting-message">{t('내 API 계정의 사용량으로 처리해요. Workers AI는 요약과 번역, DeepL은 번역에 쓰여요.', 'Runs on your own API accounts’ usage. Workers AI handles summaries and translation; DeepL handles translation.')}</p>
    {!config.storage && <p className="feedex-setting-message" role="status">{t('서버에 개인 API 키를 저장할 준비가 되지 않았어요.', 'The server is not set up to store personal API keys.')}</p>}
    <div className="feedex-auto-refresh-setting">
      <SettingLabel icon={Languages}>Workers AI <small>{config.workersAi ? t('저장됨', 'Saved') : t('요약·번역', 'Summary · translation')}</small></SettingLabel>
      {config.workersAi && <button type="button" className="feedex-cache-clear" aria-label={t('Workers AI 연결 해제', 'Disconnect Workers AI')} disabled={busy} onClick={() => void change('workers-ai', false)}>{t('연결 해제', 'Disconnect')}</button>}
    </div>
    {!config.workersAi && <form className="feedex-personal-key-form" autoComplete="off" onSubmit={event => { event.preventDefault(); if (accountId.trim() && token.trim()) void change('workers-ai', true); }}>
      <div className="feedex-translation-key"><input type="text" aria-label={t('Cloudflare 계정 ID', 'Cloudflare account ID')} placeholder={t('Cloudflare 계정 ID', 'Cloudflare account ID')} value={accountId} maxLength={32} disabled={busy || !config.storage} autoComplete="off" spellCheck={false} onChange={event => setAccountId(event.target.value)} /></div>
      <div className="feedex-translation-key"><input type="password" aria-label={t('Workers AI API 토큰', 'Workers AI API token')} placeholder={t('Workers AI API 토큰', 'Workers AI API token')} value={token} maxLength={128} disabled={busy || !config.storage} autoComplete="new-password" spellCheck={false} onChange={event => setToken(event.target.value)} />
        <button type="submit" className="feedex-cache-clear" disabled={busy || !config.storage || !accountId.trim() || !token.trim()}>{t('저장', 'Save')}</button></div>
      <a className="feedex-setting-message underline" href="https://developers.cloudflare.com/workers-ai/get-started/rest-api/" target="_blank" rel="noopener noreferrer">{t('Workers AI API 토큰 발급 방법', 'How to get a Workers AI API token')}</a>
    </form>}
    <div className="feedex-auto-refresh-setting">
      <SettingLabel icon={Languages}>DeepL <small>{config.deepl ? t('연결됨 · 번역에 우선 사용', 'Connected · used first for translation') : t('번역 · 선택 사항', 'Translation · optional')}</small></SettingLabel>
      {config.deepl && <button type="button" className="feedex-cache-clear" aria-label={t('DeepL 연결 해제', 'Disconnect DeepL')} disabled={busy} onClick={() => void change('deepl', false)}>{t('연결 해제', 'Disconnect')}</button>}
    </div>
    {!config.deepl && <form className="feedex-translation-key" autoComplete="off" onSubmit={event => { event.preventDefault(); if (key.trim()) void change('deepl', true); }}>
      <input type="password" aria-label={t('DeepL API 키', 'DeepL API key')} placeholder={t('DeepL API 키', 'DeepL API key')} value={key} maxLength={120} disabled={busy || !config.storage} autoComplete="new-password" spellCheck={false} onChange={event => setKey(event.target.value)} />
      <button type="submit" className="feedex-cache-clear" disabled={busy || !config.storage || !key.trim()}>{t('저장', 'Save')}</button>
    </form>}
    {message && <p className="feedex-setting-message" role="status">{message}</p>}
  </div>;
}
