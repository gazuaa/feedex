import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../client/api';

export interface TranslationConfig {
  canManage: boolean;
  provider?: 'deepl' | 'workers-ai';
  managed?: boolean;
  usage?: { used: number; limit: number } | null;
  problem?: string | null;
  storage?: boolean;
}

const count = (value: number) => value.toLocaleString('ko-KR');

/**
 * 번역 설정. 운영자에게만 보인다. DeepL API 키를 넣으면 DeepL로, 없으면 Workers AI로 번역한다.
 * 키는 서버에 암호화해 저장하고 화면에는 다시 보여 주지 않는다.
 */
export function TranslationSetting({ initial }: { initial?: TranslationConfig }) {
  const [config, setConfig] = useState<TranslationConfig | null>(initial ?? null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
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
  if (!config?.canManage) return <span ref={probe} hidden />;
  const deepl = config.provider === 'deepl';
  const run = async (request: () => Promise<TranslationConfig>, done: string) => {
    setBusy(true); setMessage('');
    try { setConfig(await request()); setKey(''); setMessage(done); }
    catch (error) { setMessage(error instanceof Error && error.message ? error.message : '저장하지 못했어요.'); }
    finally { setBusy(false); }
  };
  const detail = deepl
    ? config.problem ?? (config.usage ? `이번 달 ${count(config.usage.used)} / ${count(config.usage.limit)}자 사용` : 'DeepL로 번역해요')
    : 'DeepL API 키를 넣으면 DeepL로 번역해요';
  return <div className="feedex-translation-setting">
    <div className="feedex-auto-refresh-setting"><span>번역 엔진<small>{detail}</small></span><strong className="text-xs">{deepl ? 'DeepL' : 'Workers AI'}</strong></div>
    {config.managed
      ? <p className="feedex-setting-message">DeepL API 키는 서버에서 관리 중이에요.</p>
      : deepl
        ? <p className="feedex-setting-message">DeepL 키가 저장돼 있어요. 한도를 넘거나 키가 막히면 Workers AI로 번역해요. <button type="button" className="feedex-setting-link" disabled={busy} onClick={() => { void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'DELETE' }), 'DeepL 키를 지웠어요.'); }}>키 지우기</button></p>
        : <form className="feedex-translation-key" autoComplete="off" onSubmit={(event) => { event.preventDefault(); if (key.trim()) void run(() => apiRequest<TranslationConfig>('/api/translation/deepl', { method: 'PUT', body: JSON.stringify({ key: key.trim() }) }), 'DeepL 키를 저장했어요.'); }}>
            <input type="password" aria-label="DeepL API 키" placeholder="DeepL API 키" value={key} maxLength={120} disabled={busy || config.storage === false} autoComplete="new-password" spellCheck={false} onChange={(event) => setKey(event.target.value)} />
            <button type="submit" className="feedex-cache-clear" disabled={busy || !key.trim() || config.storage === false}>저장</button>
          </form>}
    {!deepl && !config.managed && <p className="feedex-setting-message">{config.storage === false ? '서버에 키 저장 준비가 안 돼 있어요.' : 'DeepL 계정의 API Keys에서 복사해 넣어 주세요. DeepL 앱 구독과는 별개예요.'}</p>}
    {message && <p className="feedex-setting-message" role="status">{message}</p>}
  </div>;
}
