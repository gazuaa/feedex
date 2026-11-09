import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { apiRequest, type ArticleItem } from '../client/api';
import { readContent, writeContent } from '../client/deviceContent';
import { WebPager } from './ArticleDrawer';
import { framedCopy, useMobileViewport } from '../client/mobile';
import { xThreadPreview } from '../client/xThreadPreview';
import { useCopyTheme } from '../client/copyTheme';
import { useXPostFrame } from '../client/xPostFrame';
import { isXStatusUrl } from '../shared/xFeed';
import { X_THREAD_MARK } from '../shared/xThreadStyle';
import type { XPost } from '../client/xTimeline';

export interface XPostTarget { articleId: string; url: string; quote?: XPost['quote'] }
type Copy = { html: string; url: string; thread: true; partial?: true };
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
  const [copy, setCopy] = useState<{ url: string; html: string } | null>(null), [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null), url = trail.at(-1)!;
  const isMobile = useMobileViewport();
  const back = () => trail.length > 1 ? setTrail((items) => items.slice(0, -1)) : onBack();
  const open = useCallback((next: string, hint?: { text: string; name?: string; handle?: string }) => {
    const match = /^https?:\/\/(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com)|[^/]+)\/([a-z\d_]{1,15})\/status\/(\d{1,20})(?:[/?#]|$)/i.exec(next);
    if (match) {
      const normalized = `https://x.com/${match[1]}/status/${match[2]}`;
      if (hint?.text) {
        setHints((m) => new Map(m).set(normalized, { name: hint.name || '', handle: hint.handle || '', text: hint.text, href: normalized, media: [] }));
      }
      setTrail((items) => items.at(-1) === normalized ? items : [...items, normalized]);
    }
  }, []);
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
      if (cached && 'html' in cached.data && cached.data.html.includes(X_THREAD_MARK)) {
        setCopy({ url, html: enhanceCopyHtml(cached.data.html, activeQuote) });
        return;
      }
      const result = await apiRequest<Copy>(`/api/articles/${encodeURIComponent(source.id)}/x-post?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      if (!active) return;
      const enhancedHtml = enhanceCopyHtml(result.html, activeQuote);
      setCopy({ url, html: enhancedHtml });
      // 원글을 못 불러온 답글 사본은 저장하지 않고 다음에 다시 받는다.
      if (!result.partial) await writeContent(accountId, key, { ...result, html: enhancedHtml });
    };
    void load().catch(() => { if (active) setError('글을 불러오지 못했어요. 다시 시도해 주세요.'); });
    return () => { active = false; controller.abort(); };
  }, [accountId, source.id, url, retry, activeQuote]);
  const isReady = copy?.url === url;
  const html = useMemo(() => framedCopy(isReady ? copy.html : preview), [isReady, copy?.html, preview]);
  // 사본이 준비되면 새 프레임으로 넘어가되, 새 프레임이 로드될 때까지 미리보기를 유지해 검은 화면 깜빡임을 막는다.
  const [holdingPreview, setHoldingPreview] = useState<{ url: string; html: string } | null>(null);
  useEffect(() => {
    if (!isReady && preview) setHoldingPreview({ url, html: framedCopy(preview) });
  }, [isReady, preview, url]);
  useEffect(() => { setHoldingPreview(null); }, [url]);
  useEffect(() => {
    if (isReady && holdingPreview) {
      const timer = setTimeout(() => setHoldingPreview(null), 400);
      return () => clearTimeout(timer);
    }
  }, [isReady, holdingPreview]);
  return <section aria-label="앱에서 X 글 보기" className={`feedex-article-reader fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-auto flex h-full min-h-0 min-w-0 w-full flex-col ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'}`}>
    <header className={`feedex-linked-post-header flex items-center gap-2 border-b px-3 py-3 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2" onClick={back}><ChevronLeft size={21} /><span>{trail.length > 1 ? '이전 글' : '원래 글'}</span></button>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-500">@{url.split('/')[3]}</span>
      <button type="button" aria-label="X 글 새로고침" className="p-3" onClick={() => { setCopy(null); setRetry((value) => value + 1); }}><RefreshCw size={19} /></button>
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="X에서 열기" className="p-3"><ExternalLink size={19} /></a>
    </header>
    {error && <p role="status" className="px-4 py-2 text-sm text-slate-500">{error}</p>}
    <WebPager enabled={isMobile} onBack={back}><div className="relative flex-1 min-h-0 w-full overflow-hidden feedex-web-frame">
      <iframe
        key={`${url}:${isReady ? 'ready' : 'preview'}`}
        ref={frame}
        title={`${activeQuote?.name || handle} X 글`}
        srcDoc={html}
        onLoad={() => { if (isReady) setHoldingPreview(null); }}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        style={{ colorScheme: isDark ? 'dark' : 'light' }}
        className="absolute inset-0 h-full w-full border-0 feedex-web-frame"
      />
      {isReady && holdingPreview && holdingPreview.url === url && (
        <iframe
          key={`${url}:preview-hold`}
          title={`${activeQuote?.name || handle} X 글`}
          srcDoc={holdingPreview.html}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          style={{ colorScheme: isDark ? 'dark' : 'light', zIndex: 1, pointerEvents: 'none' }}
          className="absolute inset-0 h-full w-full border-0 feedex-web-frame"
        />
      )}
    </div></WebPager>
  </section>;
}
