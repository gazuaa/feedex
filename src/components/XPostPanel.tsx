import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, Languages, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { apiRequest, type ArticleItem } from '../client/api';
import { readContent, writeContent } from '../client/deviceContent';
import { AiSummaryCard, WebPager } from './ArticleDrawer';
import { framedCopy, useMobileViewport } from '../client/mobile';
import { xThreadPreview } from '../client/xThreadPreview';
import { useCopyTheme } from '../client/copyTheme';
import { useXPostFrame } from '../client/xPostFrame';
import { X_THREAD_MARK, X_THREAD_STYLE, X_VIDEO_STYLE } from '../shared/xThreadStyle';
import type { XPost } from '../client/xTimeline';

export interface XPostTarget { articleId: string; url: string; quote?: XPost['quote'] }
type Copy = { html: string; url: string; thread?: boolean; partial?: boolean; translationProof?: string };
type Translation = { html: string; provider: string; alreadyKorean?: boolean; notice?: string };
type Summary = { copy: Copy; open: boolean; pending: boolean; text?: string; error?: string };
/** 사본이 다 그려지기를 기다리며 미리보기를 덮어 두는 최대 시간. 이미지가 멈춰도 이 뒤에는 사본을 보여 준다. */
const PREVIEW_HOLD_MS = 3000;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 미러 서버가 긴 글을 일부만 잘라 보낸 경우, 인용 원문에 있던 전체 글로 본문을 복원한다. */
function enhanceCopyHtml(html: string, quote?: XPost['quote']): string {
  if (!quote?.text) return html;
  const match = /<article\b[^>]*\bclass="[^"]*\bmain\b[^"]*"[^>]*>[\s\S]*?<div\b[^>]*\bclass="[^"]*\btext\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (!match) return html;
  const currentText = match[1].replace(/<[^>]+>/g, '').trim();
  if (quote.text.length <= currentText.length + 30) return html;
  const paragraphs = quote.text.split(/\n{2,}/).filter(Boolean);
  const textHtml = paragraphs.length
    ? paragraphs.map((p) => `<p>${escape(p).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, '<br>')}</p>`).join('')
    : escape(quote.text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, '<br>');
  const replacement = match[0].replace(match[1], textHtml);
  return html.replace(match[0], replacement);
}

/** 구독 목록을 바꾸지 않고 인용 글·댓글을 현재 본문 영역에서 읽는다. */
export function XPostPanel({ accountId, source, target, onBack, isDark }: { accountId: string; source: ArticleItem; target: XPostTarget; onBack: () => void; isDark: boolean }) {
  const [trail, setTrail] = useState([target.url]), [retry, setRetry] = useState(0);
  const [hints, setHints] = useState<Map<string, XPost['quote']>>(new Map());
  const [copy, setCopy] = useState<Copy | null>(null), [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null), url = trail.at(-1)!;
  const activeCopy = copy?.url === url ? copy : null;
  const [translation, setTranslation] = useState<{ copy: Copy; result: Translation } | null>(null);
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const translationRequest = useRef<AbortController | null>(null);
  const result = activeCopy && translation?.copy === activeCopy ? translation.result : null;
  const showTranslation = Boolean(translated && result && !result.alreadyKorean);
  const [summary, setSummary] = useState<Summary | null>(null);
  const summaryRequest = useRef<AbortController | null>(null);
  const activeSummary = summary?.copy === activeCopy ? summary : null;
  const isMobile = useMobileViewport();
  const back = () => trail.length > 1 ? setTrail((items) => items.slice(0, -1)) : onBack();
  const open = useCallback((next: string, hint?: { text: string; name?: string; handle?: string }) => {
    const match = /^https?:\/\/(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com)|[^/]+)\/([a-z\d_]{1,15})\/status\/(\d{1,20})(?:[/?#]|$)/i.exec(next);
    if (match) {
      const normalized = `https://x.com/${match[1]}/status/${match[2]}`;
      if (hint?.text && !showTranslation) {
        setHints((m) => new Map(m).set(normalized, { name: hint.name || '', handle: hint.handle || '', text: hint.text, href: normalized, media: [] }));
      }
      setTrail((items) => items.at(-1) === normalized ? items : [...items, normalized]);
    }
  }, [showTranslation]);
  useCopyTheme(frame, isDark);
  useXPostFrame(frame, open, url);
  const activeQuote = url === target.url ? target.quote : hints.get(url) || null;
  const handle = /^https:\/\/x\.com\/([^/]+)\//.exec(url)?.[1] || 'X';
  const preview = useMemo(() => {
    const quote = activeQuote;
    const media = (quote?.media || []).map((item) => item.video ? `<a href="${escape(url)}">Video<img src="${escape(item.src)}"></a>` : `<img src="${escape(item.src)}">`).join('');
    const paragraphs = (quote?.text || '').split(/\n{2,}/).filter(Boolean);
    const textHtml = paragraphs.length
      ? paragraphs.map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('')
      : `<p>${escape(quote?.text || '')}</p>`;
    return xThreadPreview({ ...source, url, title: quote?.text || '글을 불러오는 중…', published_at: '', feed_title: `${quote?.name || handle} (@${handle})`, feed_html_url: `https://x.com/${handle}`, feed_favicon: null, content_html: `${textHtml}${media}` }, Boolean(error));
  }, [url, activeQuote, handle, source, error]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(); setError('');
    const load = async () => {
      const key = `x-post:${url}`, cached = retry ? undefined : await readContent(accountId, key);
      if (!active) return;
      if (cached && 'html' in cached.data && !cached.data.partial && cached.data.html.includes(X_THREAD_MARK)) {
        setCopy(cached.data);
        return;
      }
      const result = await apiRequest<Copy>(`/api/articles/${encodeURIComponent(source.id)}/x-post?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      if (!active) return;
      setCopy(result);
      // 원글을 못 불러온 답글 사본은 저장하지 않고 다음에 다시 받는다.
      if (!result.partial) await writeContent(accountId, key, result);
    };
    void load().catch(() => { if (active) setError('글을 불러오지 못했어요. 다시 시도해 주세요.'); });
    return () => { active = false; controller.abort(); };
  }, [accountId, source.id, url, retry]);
  useEffect(() => {
    setTranslated(false); setTranslating(false); setTranslationError('');
    return () => { translationRequest.current?.abort(); translationRequest.current = null; };
  }, [accountId, source.id, url, retry]);
  useEffect(() => () => { summaryRequest.current?.abort(); summaryRequest.current = null; }, [accountId, source.id, url, retry]);
  const snapshot = activeCopy?.translationProof && !activeCopy.partial ? { html: activeCopy.html, proof: activeCopy.translationProof } : undefined;
  const toggleTranslation = async () => {
    if (translationRequest.current) {
      translationRequest.current.abort(); translationRequest.current = null; setTranslating(false);
      return;
    }
    if (!activeCopy) return;
    if (showTranslation) { setTranslated(false); return; }
    if (result) { setTranslated(true); return; }
    const controller = new AbortController();
    translationRequest.current = controller;
    setTranslating(true); setTranslationError('');
    try {
      const response = await apiRequest<Translation>(`/api/articles/${encodeURIComponent(source.id)}/translate`, {
        method: 'POST', body: JSON.stringify({ source: 'full', xUrl: url, xThread: snapshot }), signal: controller.signal,
      });
      if (translationRequest.current !== controller) return;
      setTranslation({ copy: activeCopy, result: response }); setTranslated(true);
    } catch (err) {
      if (translationRequest.current === controller) setTranslationError(err instanceof Error ? err.message : '번역하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (translationRequest.current === controller) { translationRequest.current = null; setTranslating(false); }
    }
  };
  const loadSummary = async () => {
    if (!activeCopy || summaryRequest.current) return;
    const controller = new AbortController();
    summaryRequest.current = controller;
    const pending = { copy: activeCopy, open: true, text: activeSummary?.text };
    setSummary({ ...pending, pending: true });
    try {
      const response = await apiRequest<{ aiSummary: string }>(`/api/articles/${encodeURIComponent(source.id)}/summarize`, {
        method: 'POST', body: JSON.stringify({ xUrl: url, xThread: snapshot }), signal: controller.signal,
      });
      if (summaryRequest.current === controller) setSummary({ ...pending, pending: false, text: response.aiSummary });
    } catch (error) {
      if (summaryRequest.current === controller) setSummary({ ...pending, pending: false, error: error instanceof Error ? error.message : '요약하지 못했어요. 다시 시도해 주세요.' });
    } finally {
      if (summaryRequest.current === controller) summaryRequest.current = null;
    }
  };
  const toggleSummary = () => {
    if (activeSummary?.open) {
      summaryRequest.current?.abort(); summaryRequest.current = null;
      setSummary({ ...activeSummary, open: false, pending: false });
    } else if (activeSummary?.text) {
      setSummary({ ...activeSummary, open: true, error: undefined });
    } else void loadSummary();
  };
  const isReady = Boolean(activeCopy);
  const readyHtml = useMemo(() => {
    if (!activeCopy) return undefined;
    if (!showTranslation || !result) return framedCopy(enhanceCopyHtml(activeCopy.html, activeQuote));
    return framedCopy(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escape(url)}" target="_blank">${X_THREAD_MARK}<style>${X_THREAD_STYLE}${X_VIDEO_STYLE}</style></head><body><main>${result.html}</main></body></html>`);
  }, [activeCopy, activeQuote, showTranslation, result, url]);
  const previewHtml = useMemo(() => framedCopy(preview), [preview]);
  // 사본이 준비돼도 미리보기 프레임은 지우거나 새로 만들지 않고 위에 그대로 둔다. 그 아래에서 사본을 다 그리면
  // 미리보기를 걷어 낸다. 미리보기를 새 프레임에 다시 그리면 같은 글을 한 번 더 불러오며 화면이 비어 깜빡인다.
  const [holdingPreview, setHoldingPreview] = useState<{ url: string; html: string } | null>(null);
  useEffect(() => {
    if (!isReady && preview) setHoldingPreview({ url, html: previewHtml });
  }, [isReady, preview, previewHtml, url]);
  // 다른 글로 바뀌면 그릴 때 주소로 걸러진다. 여기서 지우면 처음 열 때 방금 잡아 둔 미리보기까지 지워진다.
  useEffect(() => {
    // 사본이 끝내 다 불러와지지 않아도(멈춘 이미지 등) 미리보기에 오래 머물지 않는다.
    if (isReady && holdingPreview) {
      const timer = setTimeout(() => setHoldingPreview(null), PREVIEW_HOLD_MS);
      return () => clearTimeout(timer);
    }
  }, [isReady, holdingPreview]);
  const frameTitle = `${activeQuote?.name || handle} X 글`;
  const frameStyle = { colorScheme: isDark ? 'dark' : 'light' } as const;
  const translateAction = translating ? '번역 취소' : showTranslation ? '원문 보기' : '번역';
  const summaryAction = activeSummary?.pending ? '요약 취소' : activeSummary?.open ? '요약 닫기' : '요약';
  return <section aria-label="앱에서 X 글 보기" className={`feedex-article-reader fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-auto flex h-full min-h-0 min-w-0 w-full flex-col ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'}`}>
    <header className={`feedex-linked-post-header flex items-center gap-2 border-b px-3 py-3 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2" onClick={back}><ChevronLeft size={21} /><span>{trail.length > 1 ? '이전 글' : '원래 글'}</span></button>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-500">@{url.split('/')[3]}</span>
      <button type="button" aria-label={translateAction} title={translateAction} aria-pressed={showTranslation} disabled={!isReady}
        className="p-3 disabled:opacity-40" onClick={() => void toggleTranslation()}>
        {translating ? <Loader2 size={19} className="animate-spin" /> : <Languages size={19} />}
      </button>
      <button type="button" aria-label={summaryAction} title={summaryAction} aria-pressed={activeSummary?.open ?? false} disabled={!isReady}
        className={`inline-flex items-center gap-1.5 p-3 disabled:opacity-40 ${activeSummary?.open ? 'text-emerald-600 dark:text-emerald-400' : ''}`} onClick={toggleSummary}>
        {activeSummary?.pending ? <Loader2 size={19} className="animate-spin" /> : <Sparkles size={19} />}
        <span className="hidden sm:inline text-xs font-semibold">요약</span>
      </button>
      <button type="button" aria-label="X 글 새로고침" className="p-3" onClick={() => { setCopy(null); setRetry((value) => value + 1); }}><RefreshCw size={19} /></button>
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="X에서 열기" className="p-3"><ExternalLink size={19} /></a>
    </header>
    {error && <p role="status" className="px-4 py-2 text-sm text-slate-500">{error}</p>}
    {(translating || translationError || (translated && result)) && <p role={translationError ? 'alert' : 'status'} className="px-4 py-2 text-sm text-slate-500">
      {translationError || (translating ? '한국어로 번역하는 중…' : result?.alreadyKorean ? '이미 한국어로 된 글이에요.' : result?.notice || `${result?.provider === 'deepl' ? 'DeepL' : 'Workers AI'} 번역`)}
    </p>}
    {activeSummary?.open && <div className="feedex-web-summary">
      <AiSummaryCard isDark={isDark} summarizing={activeSummary.pending} summary={activeSummary.text} error={activeSummary.error || ''}
        loadingLabel="X 글을 요약하는 중…" onRegenerate={loadSummary} onClose={toggleSummary} />
    </div>}
    <WebPager enabled={isMobile} onBack={back}><div className="relative flex-1 min-h-0 w-full overflow-hidden feedex-web-frame">
      {isReady && (
        <iframe
          key={`${url}:ready`}
          ref={frame}
          title={frameTitle}
          srcDoc={readyHtml}
          onLoad={() => setHoldingPreview(null)}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={frameStyle}
          className="absolute inset-0 h-full w-full border-0 feedex-web-frame"
        />
      )}
      {/* 미리보기 프레임. 사본이 도착해도 같은 프레임을 그대로 두므로 다시 불러오지 않는다. */}
      {(!isReady || holdingPreview?.url === url) && (
        <iframe
          key={`${url}:preview`}
          ref={isReady ? undefined : frame}
          title={frameTitle}
          srcDoc={isReady ? holdingPreview!.html : previewHtml}
          aria-hidden={isReady ? true : undefined}
          tabIndex={isReady ? -1 : undefined}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={isReady ? { ...frameStyle, zIndex: 1, pointerEvents: 'none' } : frameStyle}
          className="absolute inset-0 h-full w-full border-0 feedex-web-frame"
        />
      )}
    </div></WebPager>
  </section>;
}
