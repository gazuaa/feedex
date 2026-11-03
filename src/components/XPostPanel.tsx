import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { apiRequest, type ArticleItem } from '../client/api';
import { readContent, writeContent } from '../client/deviceContent';
import { WebPager } from './ArticleDrawer';
import { framedCopy, useMobileViewport } from '../client/mobile';
import { xThreadPreview } from '../client/xThreadPreview';
import { useXPostFrame } from '../client/xPostFrame';
import { isXStatusUrl } from '../shared/xFeed';
import { X_THREAD_MARK } from '../shared/xThreadStyle';
import type { XPost } from '../client/xTimeline';

export interface XPostTarget { articleId: string; url: string; quote?: XPost['quote'] }
type Copy = { html: string; url: string; thread: true };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 구독 목록을 바꾸지 않고 인용 글·댓글을 현재 본문 영역에서 읽는다. */
export function XPostPanel({ accountId, source, target, onBack, isDark }: { accountId: string; source: ArticleItem; target: XPostTarget; onBack: () => void; isDark: boolean }) {
  const [trail, setTrail] = useState([target.url]), [retry, setRetry] = useState(0);
  const [copy, setCopy] = useState<{ url: string; html: string } | null>(null), [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null), url = trail.at(-1)!;
  const isMobile = useMobileViewport();
  const back = () => trail.length > 1 ? setTrail((items) => items.slice(0, -1)) : onBack();
  const open = useCallback((next: string) => { if (isXStatusUrl(next)) setTrail((items) => items.at(-1) === next ? items : [...items, next]); }, []);
  useXPostFrame(frame, open);
  const preview = useMemo(() => {
    const quote = url === target.url ? target.quote : null, handle = /^https:\/\/x\.com\/([^/]+)\//.exec(url)?.[1] || 'X';
    const media = quote?.media.map((item) => item.video ? `<a href="${escape(url)}">Video<img src="${escape(item.src)}"></a>` : `<img src="${escape(item.src)}">`).join('') || '';
    return xThreadPreview({ ...source, url, title: quote?.text || '글을 불러오는 중…', published_at: '', feed_title: `${quote?.name || handle} (@${handle})`, feed_html_url: `https://x.com/${handle}`, feed_favicon: null, content_html: `<p>${escape(quote?.text || '')}</p>${media}` }, Boolean(error));
  }, [url, target, source, error]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController(); setError('');
    const load = async () => {
      const key = `x-post:${url}`, cached = retry ? undefined : await readContent(accountId, key);
      if (!active) return;
      if (cached && 'html' in cached.data && cached.data.html.includes(X_THREAD_MARK)) { setCopy({ url, html: cached.data.html }); return; }
      const result = await apiRequest<Copy>(`/api/articles/${encodeURIComponent(source.id)}/x-post?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      if (!active) return;
      setCopy({ url, html: result.html });
      await writeContent(accountId, key, result);
    };
    void load().catch(() => { if (active) setError('글을 불러오지 못했어요. 다시 시도해 주세요.'); });
    return () => { active = false; controller.abort(); };
  }, [accountId, source.id, url, retry]);
  const html = useMemo(() => framedCopy(copy?.url === url ? copy.html : preview), [copy, url, preview]);
  return <section aria-label="앱에서 X 글 보기" className={`sfeed-article-reader fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-auto flex h-full min-h-0 min-w-0 w-full flex-col ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'}`}>
    <header className={`sfeed-linked-post-header flex items-center gap-2 border-b px-3 py-3 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
      <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2" onClick={back}><ChevronLeft size={21} /><span>{trail.length > 1 ? '이전 글' : '원래 글'}</span></button>
      <span className="min-w-0 flex-1 truncate text-sm text-slate-500">@{url.split('/')[3]}</span>
      <button type="button" aria-label="X 글 새로고침" className="p-3" onClick={() => { setCopy(null); setRetry((value) => value + 1); }}><RefreshCw size={19} /></button>
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="X에서 열기" className="p-3"><ExternalLink size={19} /></a>
    </header>
    {error && <p role="status" className="px-4 py-2 text-sm text-slate-500">{error}</p>}
    <WebPager enabled={isMobile} onBack={back}><iframe ref={frame} title="인용한 X 글" srcDoc={html} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0 bg-white" /></WebPager>
  </section>;
}
