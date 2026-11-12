import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  Circle,
  Sparkles,
  BookOpen,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCw,
  Rss,
  ChevronDown,
  MoreHorizontal,
  ChevronUp,
  Share2,
  Mail,
  MessageSquare,
  Link2,
  Send,
  AtSign,
  RotateCw,
  X,
  Languages,
} from 'lucide-react';
import {
  apiRequest,
  formatRelativeTime,
  type ArticleItem,
  type ArticleViewMode as ViewMode,
} from '../client/api';
import { useCopyTheme } from '../client/copyTheme';
import { useTextSize } from '../client/textSize';
import { useMobileViewport, useScrollChrome, framedCopy } from '../client/mobile';
import { dropSiteClasses } from '../shared/siteClasses';
import { isCurrentSummary } from '../shared/aiSummary';
import { shareLinks } from '../client/share';
import { dropArticleChrome, titleKey } from '../shared/articleChrome';
import { bindWebPager } from '../client/webPager';
import type { ArticleResources, WebResult } from '../client/articleResources';
import { readFeedPreference, saveFeedPreference } from '../client/devicePreferences';
import { WebLabel, WebStatusBar } from './WebStatusBar';
import { htmlToText, openInDeepL } from '../client/deeplWeb';
import { TextSizeControl } from './ReadingSettings';
import { publicDeviceArticle } from '../shared/publicWebPage';
import { isXStatusUrl } from '../shared/xFeed';
import { xThreadPreview } from '../client/xThreadPreview';
import { retryChallenged } from '../client/publicWebCopy';
import { useXPostFrame, useYouTubeCopyFrame, type XQuoteHint } from '../client/xPostFrame';
import { youtubeEmbedSrc } from '../shared/youtubeEmbed';
import { bindArticleImages, bodyShowsImage } from '../client/articleImages';
import { shownThumbnail } from '../client/thumbnails';
import { inNativeApp, nativeBridge, nativePlatform, useNativeArticle } from '../client/nativeApp';

const VIEW_MODES = [
  { id: 'feed', label: '피드', title: '피드 본문 — RSS에 담긴 내용', Icon: Rss },
  { id: 'reader', label: '리더', title: '전체 본문 — 원문에서 본문만 깔끔하게', Icon: BookOpen },
  { id: 'web', label: '웹', title: '웹 페이지 — 원본 사이트 그대로', Icon: Globe },
] as const;

// 웹 보기 확대 단계는 브라우저와 같다. 프레임 안 페이지는 다른 출처라서 바깥에서
// 크기를 바꾼다: (영역 크기 ÷ 배율)로 배치한 뒤 scale(배율)을 건다.
// 알맞은 배율은 화면에 따라 다르므로 기기마다 기억한다.
const WEB_ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];
const frameScaleStyle = (scale: number): React.CSSProperties => ({ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: '0 0' });
// 세로 스크롤 막대가 자리를 차지하는 브라우저에서도 옆으로 넘치지 않게 그만큼 넓게 배치한다.
const FRAME_SCROLLBAR = 20;
/**
 * 폭을 고정한 사이트(viewport width=1080 등)는 칸보다 좁게 배치되면 옆으로 넘친다. 프레임 안 페이지는 앱이 고칠 수
 * 없으므로, 사이트가 밝힌 폭으로 배치한 뒤 칸에 맞게 줄인다. 휴대폰 브라우저가 이 값을 따르는 것과 같다.
 * 휴대폰에서는 같은 사이트가 스스로 맞추는 화면을 보내기도 해서 서버가 받은 폭을 쓰지 않는다.
 */
export function fixedLayoutFit(layoutWidth: number | undefined, paneWidth: number, userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): number {
  if (!layoutWidth || !paneWidth || /iPhone|iPod|Android.*Mobile/i.test(userAgent)) return 1;
  return Math.min(1, paneWidth / (layoutWidth + FRAME_SCROLLBAR));
}
/** 휴대폰 웹 보기 위쪽의 상태 줄 높이. index.css의 --feedex-web-status-height와 같아야 한다. */
const WEB_STATUS_HEIGHT = 28;
/** 휴대폰 하단 막대가 사이트 아래쪽을 가리는 높이. 사본은 이만큼 끝에 여백을 둔다. */
const WEB_DOCK_SPACE = 64;
/** 프레임 안 사이트 위로 꺼낸 막대가 다시 접히기 전까지 머무는 시간. */
const PEEK_MS = 4000;
// 사이트 프레임이 다 불러왔다고 알리지 않아도 이만큼 기다린 뒤에는 보여 준다. 광고나 끝나지 않는 요청이 있는 사이트가 있다.
// 한경·AI타임스 기사는 1~2초 안에 다 불러온다.
const FRAME_WAIT_MS = 4000;
/** X 글 완성본이 다 그려지기를 기다리며 미리보기를 덮어 두는 최대 시간. 이미지가 멈춰도 이 뒤에는 완성본을 보여 준다. */
const PREVIEW_HOLD_MS = 3000;
const X_RETRY_MS = 1500;

type WebCopyState = Partial<Omit<WebResult, 'html'>> & { articleId: string; html: string | null; error?: string; fitting?: boolean; retrying?: boolean };


function loadWebZoom(account: string, feed: string): number {
  try {
    const saved = Number(readFeedPreference(account, feed).zoom);
    return WEB_ZOOM_STEPS.includes(saved) ? saved : 1;
  } catch {
    return 1;
  }
}

// 본문을 HTML로 넣으므로, 바뀔 때마다 그 자리에서 이미지를 보정한다.
function ArticleBody({ html, base, title, className, style, onOpenXPost }: { html: string; base: string; title?: string; className: string; style: React.CSSProperties; onOpenXPost?: (url: string, hint?: XQuoteHint) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    // 서버에서 클래스와 페이지 자체 머리글을 빼기 전에 저장된 본문.
    dropSiteClasses(ref.current);
    if (title) dropArticleChrome(ref.current, [titleKey(title)]);
    return bindArticleImages(ref.current, base);
  }, [html, base, title]);
  return <div ref={ref} style={style} className={className} onClick={(event) => {
    const link = (event.target as Element).closest('a[href]') as HTMLAnchorElement | null;
    if (onOpenXPost && link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const match = /^https?:\/\/(?:(?:www\.|mobile\.)?(?:twitter\.com|x\.com)|[^/]+)\/([a-z\d_]{1,15})\/status\/(\d{1,20})(?:[/?#]|$)/i.exec(link.href);
      if (match) {
        event.preventDefault();
        const normalized = `https://x.com/${match[1]}/status/${match[2]}`;
        const q = link.closest('.quote, blockquote');
        let text = '';
        if (q) {
          const c = q.cloneNode(true) as Element;
          c.querySelector('b')?.remove();
          c.querySelector('cite')?.remove();
          c.querySelector('footer')?.remove();
          c.querySelectorAll('img').forEach((i) => i.remove());
          c.querySelectorAll('br').forEach((b) => b.replaceWith('\u2028'));
          text = (c.textContent || '').replace(/[ \t]*[\r\n]+[ \t]*/g, '\n').replace(/[ \t]*\u2028[ \t]*/g, '\n').trim();
        }
        onOpenXPost(normalized, text ? { text } : undefined);
      }
    }
  }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * 웹 페이지를 다 불러올 때까지 보이는 자리. 피드 요약을 먼저 보여 주면 요약만 있는 사이트는
 * 짧은 글이 떴다가 다른 화면으로 바뀐다. 앱 테마와 같은 바탕을 써서 다크 모드에서 흰 화면이 번쩍이지 않게 한다.
 * 무엇을 하는 중인지는 위 막대가 알린다.
 */
export function WebLoading({ overlay = false }: { overlay?: boolean }) {
  return <div data-web-loading className={`${overlay ? 'absolute inset-0 z-10' : 'flex-1 min-h-0'} flex items-center justify-center feedex-web-frame`}>
    <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
  </div>;
}

/**
 * 프레임 안 사이트는 자기 터치를 그대로 쓰지만, iOS에서는 사이트가 쓰지 않는 옆으로 끌기가
 * 이 페이저로 넘어온다. 왼쪽의 빈 페이지에 멈추면 끌기를 어디서 시작했든 뒤로 간다.
 * 스크롤하는 동안 리더는 다른 보기처럼 미끄러진다. 화면 전체가 끌기를 따라 움직이고
 * 목록이 아래에서 들어온다. 사이트 페이지는 리더가 움직인 만큼 되돌려 두어서
 * 스크롤 속도대로 손가락 아래에 머문다.
 *
 * 빈 페이지에 닿아도 손가락이 떨어지고 스크롤이 멈춘 뒤에 닫는다. iOS는 끌고 있는 이 페이저와
 * 손가락 아래 프레임을 그 자리에서 지우면, 돌아간 목록이 손가락 스크롤에 움직이지 않는다.
 */
export function WebPager({ enabled, onBack, children }: { enabled: boolean; onBack: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), back = useRef(onBack);
  back.current = onBack;
  useLayoutEffect(() => {
    const pager = ref.current;
    if (!enabled || !pager) return;
    return bindWebPager(pager, () => back.current());
  }, [enabled]);
  if (!enabled) return <>{children}</>;
  return <div ref={ref} className="feedex-web-pager">
    <div className="feedex-web-pager-back" aria-hidden="true" />
    {children}
  </div>;
}

interface ArticleDrawerProps {
  accountId?: string;
  resources?: ArticleResources | null;
  article: ArticleItem | null;
  onClose: () => void;
  onOpenXPost?: (url: string, hint?: XQuoteHint) => void;
  onToggleRead: (article: ArticleItem) => void;
  onToggleSaved: (article: ArticleItem) => void;
  onUpdateArticleFields: (
    articleId: string,
    fields: Partial<ArticleItem>
  ) => void;
  // 이 글의 피드에 기억된 본문 보기.
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onNavigateRelative: (direction: 'prev' | 'next') => void;
  onCopyLink: (article: ArticleItem) => void;
  // 화면 아래에 잠깐 띄우는 안내.
  onNotice: (message: string) => void;
  // 이 창에서 원문으로 넘어가기 직전. 돌아왔을 때 보던 자리를 되살리도록 남긴다.
  onLeaveForOriginal?: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  isDark: boolean;
}

// 웹 보기 상단 안내: [전체 문구, 좁은 칸용 짧은 문구]
function webCopyNotice(xWaiting: boolean, xFailed: boolean, copy: WebCopyState | null): [string, string] {
  if (copy?.retrying && (xWaiting || copy.thread)) return ['X 원글과 댓글을 다시 불러오는 중이에요.', 'X 대화를 다시 불러오는 중'];
  if (copy?.partial) return ['공개 미러에서 원글을 받지 못했어요.', '원글을 받지 못했어요'];
  if (xWaiting && xFailed) return ['공개 미러에서 댓글을 받지 못했어요. 먼저 받은 글만 보여드려요.', '댓글을 받지 못했어요'];
  if (xWaiting || copy?.thread) return ['공개 미러(Nitter)에서 받은 X 글과 댓글이에요. 로그인한 상태로 보려면 X에서 여세요.', '공개 미러로 받은 글과 댓글'];
  if (copy?.textOnly) return ['사이트가 잠시 요청을 막아 원래 모양 대신 본문만 보여드려요.', '본문만 보여드려요'];
  if (copy?.fitting) return ['휴대폰 화면에 맞춘 사본을 준비하고 있어요.', '화면에 맞추는 중'];
  return ['사이트가 직접 표시를 막아 사본으로 보여드려요. 동영상·댓글은 원문에서 동작해요.', '사본 · 영상·댓글은 원문에서'];
}

/**
 * Cloudflare Workers AI 핵심 요약 카드. 피드·리더 보기에서는 본문 위에, 웹 보기에서는 사이트 위의 칸에 놓는다.
 * 웹 보기의 칸은 사이트를 가리므로 닫기 단추를 함께 둔다.
 */
/** 요약의 **굵은 글씨** 표시를 실제 굵은 글씨로 보여 준다. 다른 마크다운은 그대로 둔다. */
function SummaryText({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part)}</>;
}

export function AiSummaryCard({ isDark, summarizing, summary, error, onRegenerate, onClose, loadingLabel = '기사 본문을 요약하는 중…' }: { isDark: boolean; summarizing: boolean; summary?: string | null; error: string; onRegenerate: () => void; onClose?: () => void; loadingLabel?: string }) {
  // 웹 보기의 칸(onClose가 있는 경우)은 사이트를 덜 가리게 여백과 제목을 줄인다.
  return <div className={`${onClose ? 'p-3.5' : 'p-5'} rounded-2xl border relative overflow-hidden ${isDark ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-900 border-emerald-500/30' : 'bg-emerald-50/70 border-emerald-200'}`}>
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="shrink-0 p-1.5 rounded-lg bg-emerald-500 text-slate-950"><Sparkles className="w-4 h-4" /></div>
        <div className="min-w-0">
          <h3 className={`text-sm font-bold ${isDark ? 'text-emerald-300' : 'text-emerald-900'}`}>요약</h3>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {!summarizing && <button type="button" onClick={onRegenerate} title="다시 요약하기" className="whitespace-nowrap text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"><RefreshCw className="w-3 h-3" /><span>{error ? '다시 시도' : '재생성'}</span></button>}
        {onClose && <button type="button" onClick={onClose} aria-label="요약 닫기" title="요약 닫기" className="text-slate-400 hover:text-emerald-400 cursor-pointer"><X className="w-4 h-4" /></button>}
      </div>
    </div>
    {summarizing ? (
      <div role="status" className="py-4 flex items-center gap-2.5 text-sm"><Loader2 className="w-4 h-4 animate-spin" /><span>{loadingLabel}</span></div>
    ) : <>
      {error && <p role="alert" className={isDark ? 'text-sm text-rose-300' : 'text-sm text-rose-700'}>{error}</p>}
      {summary && <div className={`text-sm whitespace-pre-line leading-relaxed ${isDark ? 'text-slate-200' : 'text-slate-800'}`}><SummaryText text={summary} /></div>}
    </>}
  </div>;
}

function siteHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export const ArticleDrawer: React.FC<ArticleDrawerProps> = ({
  article,
  accountId = '',
  resources,
  onClose,
  onOpenXPost,
  onToggleRead,
  onToggleSaved,
  onUpdateArticleFields,
  viewMode,
  onChangeViewMode,
  onNavigateRelative,
  onCopyLink,
  onNotice,
  onLeaveForOriginal,
  hasPrev,
  hasNext,
  isDark,
}) => {
  const [readerFailedFor, setReaderFailedFor] = useState<string | null>(null);
  // 기사 새로고침 중인지, 원본 프레임을 몇 번 다시 불러왔는지.
  const [refreshing, setRefreshing] = useState(false);
  const [frameReloads, setFrameReloads] = useState(0);
  const shownArticleId = useRef(article?.id); shownArticleId.current = article?.id;
  const [frame, setFrame] = useState<{ articleId: string; embeddable: boolean; url: string; reason?: string; layoutWidth?: number } | null>(null);
  const [readerRetry, setReaderRetry] = useState(0);
  const mode = viewMode;
  const xPost = Boolean(article && isXStatusUrl(article.url));
  const [checkingDate, setCheckingDate] = useState(false);
  const [scrapingReader, setScrapingReader] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  // 저장된 요약은 본문 위에 펼쳐 둔다. 웹 보기에서는 사이트를 가리므로 누를 때만 연다.
  const currentAiSummary = isCurrentSummary(article?.ai_summary, xPost ? 'x' : undefined) ? article?.ai_summary : null;
  const [aiOpen, setAiOpen] = useState(Boolean(currentAiSummary) && viewMode !== 'web');
  const summaryRequest = useRef<AbortController | null>(null);
  const summaryScope = `${accountId}:${article?.id || ''}`;
  const currentSummaryScope = useRef(summaryScope); currentSummaryScope.current = summaryScope;
  const [summaryError, setSummaryError] = useState('');
  useEffect(() => {
    setAiOpen(Boolean(currentAiSummary) && mode !== 'web'); setSummarizing(false); setSummaryError('');
    return () => { summaryRequest.current?.abort(); summaryRequest.current = null; };
  }, [summaryScope]);
  // 번역. 피드 보기는 피드 본문을, 리더·웹 보기는 원문 본문을 번역해 같은 자리에 보여 준다.
  // 웹 보기에서 번역을 켜면 사이트 대신 번역한 글을 보여 준다.
  const [translation, setTranslation] = useState<{ articleId: string; source: 'full' | 'feed'; bodySource?: 'full' | 'feed'; title: string; html: string; provider: string; threadProof?: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const translateRequest = useRef<AbortController | null>(null);
  const translationSource: 'full' | 'feed' = mode === 'feed' ? 'feed' : 'full';
  const showTranslation = translated && Boolean(article) && translation?.articleId === article?.id && translation?.source === translationSource;
  useEffect(() => {
    setTranslated(false); setTranslating(false); setTranslationError('');
    return () => { translateRequest.current?.abort(); translateRequest.current = null; };
  }, [summaryScope, translationSource]);
  // 웹 보기에서 번역을 보여 주는 동안은 사이트 대신 글을 그린다.
  const siteShown = mode === 'web' && !showTranslation;
  const [fontScale] = useTextSize();
  const [webZoom, setWebZoom] = useState(() => loadWebZoom(accountId, article?.feed_id || ''));
  const [framePaneWidth, setFramePaneWidth] = useState(0);
  const framePaneRef = React.useCallback((pane: HTMLDivElement | null) => {
    if (!pane) return;
    setFramePaneWidth(pane.clientWidth);
    const observer = new ResizeObserver(() => setFramePaneWidth(pane.clientWidth));
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  // 프레임을 거부하는 사이트는 서버가 받아 온 스크립트 없는 사본으로 보여 준다.
  // textOnly: 원문 사이트가 원래 배치를 잠시 막아 받은 본문만 보여 주는 사본.
  // retrying: 보안 확인으로 막혀 잠시 뒤 자동으로 다시 받는 중.
  const [webCopy, setWebCopy] = useState<WebCopyState | null>(() => {
    if (!article || !resources) return null;
    const peeked = resources.peekCachedWeb?.(article);
    return peeked ? { articleId: article.id, ...peeked } : null;
  });
  const copyHtml = useMemo(() => webCopy?.html ? framedCopy(webCopy.html) : undefined, [webCopy?.html]);
  // X 글은 미러에서 사본을 받는 몇 초 동안, 피드로 받은 글을 사본과 같은 모양으로 같은 프레임에 먼저 그린다.
  // 사본을 받지 못하면 그 자리에 남기고 댓글 칸에만 알린다. 미러 대신 받은 x.com 화면 사본은 글도 댓글도
  // 비어 있으므로 받지 못한 것으로 본다.
  // X 대화의 인용 링크는 본문의 일부다. 기사 카드로 오인해 원글을 지우지 않도록 한다.
  const showingXTranslation = xPost && showTranslation && translation?.bodySource === 'full';
  const copyFor = webCopy?.articleId === article?.id ? webCopy : null;
  const completeThread = copyFor?.thread && !copyFor.partial && copyFor.html ? copyFor : null;
  const copyReady = Boolean(copyFor?.html) && (!xPost || Boolean(copyFor?.thread));
  const xWaiting = mode === 'web' && xPost && !copyReady && !(frame?.articleId === article?.id && frame?.embeddable);
  const xFailed = Boolean(copyFor) && !copyReady && !copyFor?.retrying;
  const xPreview = useMemo(() => xWaiting && article ? framedCopy(xThreadPreview(article, xFailed)) : undefined, [xWaiting, xFailed, article?.id, article?.title, article?.content_html, article?.feed_title, article?.feed_favicon]);
  // 완성된 사본이 도착해도 미리보기 프레임은 지우거나 새로 만들지 않고 그대로 위에 둔다. 그 아래에서 완성본을
  // 다 그리면 미리보기를 걷어 낸다. 미리보기를 다시 그리면 같은 글을 한 번 더 불러오며 화면이 비어 깜빡인다.
  const [holdingPreview, setHoldingPreview] = useState<{ articleId: string; html: string } | null>(null);
  useEffect(() => {
    if (xWaiting && xPreview && article) setHoldingPreview({ articleId: article.id, html: xPreview });
  }, [xWaiting, xPreview, article?.id]);
  // 다른 글로 바뀌면 그릴 때 글 ID로 걸러진다. 여기서 지우면 처음 열 때 방금 잡아 둔 미리보기까지 지워진다.
  useEffect(() => {
    // 완성본이 끝내 다 불러와지지 않아도(멈춘 이미지 등) 미리보기에 오래 머물지 않는다.
    if (!xWaiting && holdingPreview) {
      const timer = setTimeout(() => setHoldingPreview(null), PREVIEW_HOLD_MS);
      return () => clearTimeout(timer);
    }
  }, [xWaiting, holdingPreview]);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const shareDialogRef = useRef<HTMLDialogElement>(null);
  const closeShareDialog = () => setShareDialogOpen(false);
  useEffect(() => { setShareDialogOpen(false); }, [article?.id]);
  useLayoutEffect(() => {
    const dialog = shareDialogRef.current;
    if (!shareDialogOpen || !dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, [shareDialogOpen]);
  const [mobileMenu, setMobileMenu] = useState<'tools' | 'assist' | 'share' | null>(null);
  const closeMobileMenu = () => setMobileMenu(null);
  const isMobile = useMobileViewport();
  const openShare = () => {
    if (isMobile && !inNativeApp() && window.matchMedia('(pointer: coarse)').matches) setMobileMenu('share');
    else setShareDialogOpen(true);
  };
  const topRef = useRef<HTMLDivElement>(null), bodyRef = useRef<HTMLDivElement>(null), copyRef = useRef<HTMLIFrameElement>(null);
  useCopyTheme(copyRef, isDark);
  useXPostFrame(copyRef, onOpenXPost, `${article?.id || ''}:${mode}`);
  const { activeYouTube, ytOverlayRef, closeYouTube } = useYouTubeCopyFrame(copyRef, webZoom, `${article?.id}:${mode}:${Boolean(copyHtml)}`);
  // 프레임 안 사이트의 스크롤은 손이 닿지 않으므로, 피드·리더·웹 사본만 막대를 숨긴다.
  const showingCopy = siteShown && frame?.articleId === article?.id && frame?.embeddable === false && webCopy?.articleId === article?.id && Boolean(webCopy?.html);
  const chromeHidden = useScrollChrome(bodyRef, isMobile && Boolean(article) && !mobileMenu, `${article?.id}:${mode}:${showingCopy}:${showTranslation}`, copyRef);
  // 맥 앱에서는 웹 보기 자리에 앱이 원문 화면을 겹쳐 띄운다. 사이트를 직접 연 화면이라 로그인이 유지되고
  // 프레임을 막는 사이트도 그대로 보인다. X 글은 공개 미러 사본으로 보여 준다.
  const nativeWeb = siteShown && Boolean(article) && !xPost && inNativeApp();
  const nativeSlotRef = useRef<HTMLDivElement>(null);
  useNativeArticle(nativeSlotRef, nativeWeb && article ? article.url : null, webZoom);
  // 프레임 안 사이트 자체의 스크롤은 따라갈 수 없으므로, 불러온 뒤 몇 초만 막대를 보여 주고 접어 둔다.
  // 그 뒤에는 요청할 때만 꺼냈다가 몇 초 동안 움직임이 없으면 다시 접는다.
  const [loadedFrame, setLoadedFrame] = useState<string | null>(null);
  const framed = isMobile && siteShown && frame?.articleId === article?.id && frame?.embeddable === true && loadedFrame === article?.id;
  const [peek, setPeek] = useState(0);
  // 글을 열자마자 막대가 사라지지 않도록, 사이트를 다 불러온 순간부터 잠깐 더 보여 준다.
  // 화면에 그리기 전에 정해야 막대가 한 번 접혔다가 다시 나타나는 깜빡임이 없다.
  useLayoutEffect(() => { if (framed) setPeek((value) => value + 1); }, [framed]);
  useEffect(() => {
    if (!peek || mobileMenu) return;
    const timer = setTimeout(() => setPeek(0), PEEK_MS);
    return () => clearTimeout(timer);
  }, [peek, mobileMenu]);
  const keepPeeking = () => { if (peek) setPeek((value) => value + 1); };
  const barsHidden = !mobileMenu && (chromeHidden || (framed && !peek));
  useEffect(() => {
    if (!mobileMenu || !isMobile) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setMobileMenu(null); }
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [mobileMenu, isMobile]);
  // 웹 보기에 지금 사본과 사이트 프레임 중 무엇이 보이는지. 상단 막대와 본문이 같은 값을 쓴다.
  const webCopyShown = xWaiting || (copyReady && frame?.articleId === article?.id && !frame?.embeddable);
  const webFrameShown = !webCopyShown && frame?.articleId === article?.id && frame?.embeddable === true;
  // 사본이나 프레임을 정하기 전이거나 사본을 받는 중.
  const webPreviewShown = !webCopyShown && (!frame || frame.articleId !== article?.id || (!frame.embeddable && webCopy?.articleId !== article?.id));
  // 사이트를 넣은 프레임은 다 불러올 때까지 가려 둔다. 끝나지 않는 사이트도 있어 오래 걸리면 그대로 보여 준다.
  const [slowFrame, setSlowFrame] = useState<string | null>(null);
  useEffect(() => {
    const id = article?.id;
    if (!webFrameShown || !id || loadedFrame === id) return;
    const timer = setTimeout(() => setSlowFrame(id), FRAME_WAIT_MS);
    return () => clearTimeout(timer);
  }, [webFrameShown, article?.id, loadedFrame, frameReloads]);
  const frameLoading = webFrameShown && loadedFrame !== article?.id && slowFrame !== article?.id;
  const webStatus = webCopyShown
    ? (() => { const [notice, short] = webCopyNotice(xWaiting, xFailed, copyFor); return { notice, short, xUrl: xWaiting ? article?.url : webCopy?.thread ? frame?.url : undefined }; })()
    : webFrameShown
      ? { notice: frame.url, short: siteHost(frame.url), xUrl: undefined }
      : webPreviewShown
        ? { notice: '웹 페이지를 다 불러오면 보여 드려요.', short: '불러오는 중', xUrl: undefined }
        : null;
  const hasArticle = Boolean(article);
  // 막대는 본문 위에 떠 있어서 나타나고 사라져도 본문은 움직이지 않는다. 그 대신 본문은 막대 높이만큼 비워 두고 시작한다.
  // 막대 높이는 안전 영역과 글자 크기에 따라 다르므로 재서 읽기 영역의 변수로 넘긴다.
  const webViewRef = useRef<HTMLDivElement>(null);
  const insetCopy = useRef<() => void>(() => {});
  // 웹 사본은 문서 안에 위·아래 여백을 두어, 사이트 위에 뜬 막대 아래에서 시작하고 끝까지 읽을 수 있게 한다.
  // 사본은 배율로 키워 보이므로 보이는 크기를 배율로 나눠 넘긴다.
  insetCopy.current = () => {
    const target = copyRef.current?.contentWindow, top = topRef.current, view = webViewRef.current;
    if (!target) return;
    const safe = isMobile && view ? parseFloat(getComputedStyle(view).paddingTop) || 0 : 0;
    const inset = isMobile && top ? Math.max(0, top.offsetHeight + WEB_STATUS_HEIGHT - safe) : 0;
    target.postMessage({ sfeedInset: [inset / webZoom, (isMobile ? WEB_DOCK_SPACE : 0) / webZoom] }, '*');
  };
  useEffect(() => { insetCopy.current(); }, [isMobile, webZoom, article?.id, webCopyShown, xWaiting]);
  // 웹 사본 프레임은 배율만큼 키워 보인다. 미리보기와 완성본 프레임이 같은 모양을 쓴다.
  const copyFrameStyle: React.CSSProperties = {
    width: `${100 / webZoom}%`,
    height: `${100 / webZoom}%`,
    transform: `scale(${webZoom})`,
    transformOrigin: '0 0',
    colorScheme: isDark ? 'dark' : 'light',
  };
  useLayoutEffect(() => {
    const top = topRef.current;
    if (!top) return;
    const measure = () => { top.parentElement?.style.setProperty('--feedex-reader-top-height', `${top.offsetHeight}px`); insetCopy.current(); };
    const observer = new ResizeObserver(measure);
    observer.observe(top); measure();
    return () => observer.disconnect();
  }, [hasArticle]);

  // -1은 축소, +1은 확대, 0은 100%로 되돌린다.
  const changeWebZoom = (step: -1 | 0 | 1) => {
    const index = WEB_ZOOM_STEPS.indexOf(webZoom);
    const next =
      step === 0
        ? 1
        : WEB_ZOOM_STEPS[Math.min(WEB_ZOOM_STEPS.length - 1, Math.max(0, index + step))];
    setWebZoom(next);
    try {
      if (article) saveFeedPreference(accountId, article.feed_id, { zoom: next });
    } catch {
      // 배율은 이 글에 계속 적용된다
    }
  };

  // 리더 보기: 전체 기사는 한 번만 뽑는다. 서버가 캐시한다.
  useEffect(() => {
    if (!article || mode !== 'reader' || article.full_content_html || readerFailedFor === article.id) return;
    let active = true;
    setScrapingReader(true);
    (resources ? resources.reader(article).then((body) => ({ fullContentHtml: body.full_content_html!, publishedAt: body.published_at })) : apiRequest<{ fullContentHtml: string; publishedAt?: string }>(`/api/articles/${article.id}/reader-view`, { method: 'POST', body: '{}' }))
      .then((res) => {
        if (!active) return;
        onUpdateArticleFields(article.id, {
          full_content_html: res.fullContentHtml,
          ...(res.publishedAt ? { published_at: res.publishedAt } : {}),
        });
      })
      .catch(() => { if (active) setReaderFailedFor(article.id); })
      .finally(() => { if (active) setScrapingReader(false); });
    return () => { active = false; setScrapingReader(false); };
  }, [article?.id, article?.body_deferred, mode, readerRetry]);

  // 사이트를 바로 보여 준다. 캐시된 사본은 서버 확인 없이 그린다.
  // 원문을 프레임에 넣어도 되는지 알기 전에는 띄우지 않는다. 막는 사이트는 브라우저가 앱이 알아챌 수 없는
  // 오류 화면을 그리고, 판단이 늦거나 실패하면 그 화면에 머문다. 이미 판단한 사이트는 바로 정한다.
  useEffect(() => {
    if (!article || mode !== 'web' || nativeWeb) return;
    let active = true, retry: { stop: () => void } | undefined;
    let xRetry: ReturnType<typeof setTimeout> | undefined;
    // X는 다른 사이트의 프레임을 늘 거부하므로 묻지 않고 바로 사본을 받는다.
    const known = publicDeviceArticle(article.url) ? undefined : isXStatusUrl(article.url) ? { embeddable: false, url: article.url, reason: 'framing' } : resources?.knownFrame(article.url);
    setFrame(known ? { articleId: article.id, ...known } : null);
    const load = async () => {
      const cached = await resources?.cachedWeb(article);
      if (!active) return;
      if (cached) { setFrame({ articleId: article.id, embeddable: false, url: cached.url }); setWebCopy({ articleId: article.id, ...cached }); return; }
      if (isXStatusUrl(article.url)) {
        const loadThread = async (canRetry: boolean) => {
          const copy = await (resources ? resources.web(article) : apiRequest<WebResult>(`/api/articles/${article.id}/web-copy`)).catch(() => null);
          if (!active) return;
          if (copy?.thread && !copy.partial) { setWebCopy({ articleId: article.id, ...copy }); return; }
          // 불완전한 응답과 일시적인 실패는 미리보기를 남겨 두고 한 번 더 확인한다.
          setWebCopy(previous => ({ articleId: article.id, html: null, ...(previous?.articleId === article.id ? previous : {}), ...(copy?.thread ? copy : {}), retrying: canRetry }));
          if (canRetry) xRetry = setTimeout(() => void loadThread(false), X_RETRY_MS);
        };
        await loadThread(true);
        return;
      }
      if (resources && publicDeviceArticle(article.url)) {
        setFrame({ articleId: article.id, embeddable: false, url: article.url, reason: 'framing' });
        // 원문 사이트가 리더 서비스를 잠시 막았으면, 이 글을 보고 있는 동안 자동으로 다시 받는다.
        const attempt = retryChallenged(() => resources.web(article), (error) => { if (active) setWebCopy({ articleId: article.id, html: null, error: error.message, retrying: true }); });
        retry = attempt;
        try { const copy = await attempt.result; if (active) setWebCopy({ articleId: article.id, html: copy.html, textOnly: copy.textOnly, thread: copy.thread }); }
        catch (error) { if (active) setWebCopy({ articleId: article.id, html: null, error: error instanceof Error ? error.message : undefined }); }
        return;
      }
      // 프레임을 거부한다고 이미 알게 된 사이트는 다시 묻지 않고 바로 사본을 받는다.
      let result = known && !known.embeddable ? known : undefined;
      if (!result) {
        try {
          result = await apiRequest<{ embeddable: boolean; url: string; reason?: string; layoutWidth?: number }>(`/api/articles/${article.id}/embeddable`);
          resources?.rememberFrame(article.url, result);
        } catch {
          // 판단하지 못했으면 사본부터 받아 본다. 사본도 안 되면 "원본 다시 표시"로 프레임을 띄울 수 있다.
          result = { embeddable: false, url: article.url.replace(/^http:/, 'https:') };
        }
      }
      if (!active) return;
      setFrame({ articleId: article.id, ...result });
      if (result.embeddable) return;
      try {
        const copy = await (resources ? resources.web(article) : apiRequest<WebResult>(`/api/articles/${article.id}/web-copy`));
        if (active) setWebCopy({ articleId: article.id, ...copy });
      } catch (error) { if (active) setWebCopy({ articleId: article.id, html: null, error: error instanceof Error ? error.message : undefined }); }
    };
    void load().catch(() => {});
    return () => { active = false; retry?.stop(); clearTimeout(xRetry); };
  }, [article?.id, mode, resources]);

  // 글이 데스크톱 열 옆의 좁은 틈에 놓이는 사본(framedCopy 참고)은 한 번만,
  // 서버가 휴대폰 폭으로 배치한 사본으로 바꾼다.
  useEffect(() => {
    // 본문만 보기는 앱이 휴대폰 폭에 맞춰 만든 문서라 바꿀 필요가 없다.
    if (!isMobile || !resources || !article || webCopy?.articleId !== article.id || !webCopy.html || webCopy.phone || webCopy.textOnly || webCopy.thread) return;
    const target = article;
    const message = (event: MessageEvent) => {
      if (event.source !== copyRef.current?.contentWindow || !event.data?.sfeedSqueezed) return;
      setWebCopy((copy) => copy?.articleId === target.id ? { ...copy, phone: true, fitting: true } : copy);
      resources.phoneWeb(target)
        .then((copy) => setWebCopy((current) => current?.articleId === target.id ? { articleId: target.id, html: copy.html, phone: true } : current))
        .catch(() => setWebCopy((current) => current?.articleId === target.id ? { ...current, fitting: false } : current));
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [isMobile, resources, article?.id, webCopy?.articleId, webCopy?.html, webCopy?.phone, webCopy?.textOnly]);

  useEffect(() => {
    if (!article || article.body_deferred || article.date_source === 'original') { setCheckingDate(false); return; }
    let active = true;
    setCheckingDate(true);
    apiRequest<{ publishedAt: string; dateSource: ArticleItem['date_source'] }>(`/api/articles/${article.id}/publication-date`, { method: 'POST' })
      .then((result) => { if (active) onUpdateArticleFields(article.id, { published_at: result.publishedAt, date_source: result.dateSource }); })
      .catch(() => {})
      .finally(() => { if (active) setCheckingDate(false); });
    return () => { active = false; };
  }, [article?.id, article?.body_deferred]);

  if (!article) return <div className={`hidden lg:flex h-full flex-col items-center justify-center gap-3 px-8 text-center ${isDark ? 'bg-slate-950 text-slate-400' : 'bg-white text-slate-500'}`}>
    <BookOpen className="w-10 h-10 text-emerald-500/60" aria-hidden="true" />
    <h2 className="text-base font-semibold">읽을 글을 선택해 주세요</h2>
    <p className="text-sm">왼쪽 목록에서 글을 누르면 여기에 표시됩니다.</p>
  </div>;

  // 기사 새로고침: 지금 보기에 맞게 다시 받는다. 웹 사본과 리더 본문은 기기·서버에 남은 것을 쓰지 않고,
  // 피드 보기는 서버에 있는 최신 제목·본문을 받는다. 못 받으면 보던 내용은 그대로 둔다.
  const refreshArticle = async () => {
    if (refreshing) return;
    const target = article, here = () => shownArticleId.current === target.id;
    if (mode === 'web' && frame?.articleId === target.id && frame.embeddable) { setFrameReloads((count) => count + 1); return; }
    setRefreshing(true);
    let message = '기사를 새로 받았어요.';
    try {
      if (mode === 'web') {
        const previous = webCopy?.articleId === target.id && webCopy.html ? webCopy : null;
        if (!xPost) setWebCopy(null);
        try {
          const copy = await (resources ? resources.refreshWeb(target) : apiRequest<WebResult>(`/api/articles/${target.id}/web-copy`));
          // 원래 모양을 보던 중이면 본문만 받은 것으로 바꾸지 않는다.
          if (copy.textOnly && previous && !previous.textOnly) { if (here()) setWebCopy(previous); message = '사이트가 잠시 막아 원래 모양을 새로 받지 못했어요. 보던 사본을 그대로 둘게요.'; }
          else if (copy.partial && previous?.thread && !previous.partial) { message = 'X 원글을 새로 받지 못했어요. 보던 대화를 그대로 표시합니다.'; }
          else if (here()) setWebCopy({ articleId: target.id, ...copy });
        } catch (error) {
          if (here()) setWebCopy(previous ?? { articleId: target.id, html: null, error: error instanceof Error ? error.message : undefined });
          throw error;
        }
      } else if (mode === 'reader') {
        const body = resources
          ? await resources.reader(target, true).then((item) => ({ fullContentHtml: item.full_content_html, publishedAt: item.published_at }))
          : await apiRequest<{ fullContentHtml: string; publishedAt?: string }>(`/api/articles/${target.id}/reader-view`, { method: 'POST', body: JSON.stringify({ force: true }) });
        if (!body.fullContentHtml) throw new Error('리더 본문이 비어 있습니다.');
        onUpdateArticleFields(target.id, { full_content_html: body.fullContentHtml, ...(body.publishedAt ? { published_at: body.publishedAt } : {}) });
        if (here()) setReaderFailedFor((failed) => failed === target.id ? null : failed);
      } else {
        const latest = resources ? await resources.latest(target) : (await apiRequest<{ articles: ArticleItem[] }>(`/api/articles?articleId=${encodeURIComponent(target.id)}`)).articles[0];
        if (!latest) throw new Error('글을 찾을 수 없습니다.');
        // 읽음·저장 상태는 이 기기에서 바꾼 것이 더 새로우므로 그대로 둔다.
        const { title, author, summary, content_html, full_content_html, thumbnail_url, published_at, date_source } = latest;
        onUpdateArticleFields(target.id, { title, author, summary, content_html, full_content_html: full_content_html || target.full_content_html, thumbnail_url, published_at, date_source, body_deferred: false, body_load_error: false });
      }
    } catch { message = '기사를 새로 받지 못했어요. 보던 내용은 그대로 둘게요.'; }
    finally { setRefreshing(false); }
    if (here()) onNotice(message);
  };

  const showWebCopy = () => {
    if (xPost) { void refreshArticle(); return; }
    setFrame({ articleId: article.id, embeddable: false, url: article.url }); setWebCopy(null);
    void (resources ? resources.web(article) : apiRequest<WebResult>(`/api/articles/${article.id}/web-copy`))
      .then((copy) => setWebCopy({ articleId: article.id, ...copy }))
      .catch((error) => setWebCopy({ articleId: article.id, html: null, error: error instanceof Error ? error.message : undefined }));
  };

  const chooseViewMode = (mode: ViewMode) => {
    if (mode === 'reader') { setReaderFailedFor(null); setReaderRetry((value) => value + 1); }
    onChangeViewMode(mode);
  };

  const showingReader = mode === 'reader' && Boolean(article.full_content_html);
  const readerFailed = mode === 'reader' && readerFailedFor === article.id;
  // 사이트맵으로 만든 피드나 제목만 있는 피드에는 본문이 아예 없다.
  const bodyless = !showingReader && !article.content_html && !article.summary;

  const handleTranslate = async () => {
    translateRequest.current?.abort();
    const controller = new AbortController();
    translateRequest.current = controller;
    const current = () => !controller.signal.aborted && translateRequest.current === controller && currentSummaryScope.current === summaryScope;
    const source = translationSource;
    setTranslating(true); setTranslationError('');
    try {
      let thread = copyFor;
      if (xPost && source === 'full' && mode === 'web' && !thread?.thread && resources) {
        thread = await resources.web(article).then(copy => ({ articleId: article.id, ...copy })).catch(() => null);
      }
      if (!current()) return;
      const xThread = xPost && source === 'full' && thread?.thread && !thread.partial && thread.html && thread.translationProof
        ? { html: thread.html, proof: thread.translationProof } : undefined;
      const res = await apiRequest<{ title: string; html: string; provider: string; bodySource?: 'full' | 'feed'; notice?: string; alreadyKorean?: boolean }>(`/api/articles/${article.id}/translate`, {
        method: 'POST', body: JSON.stringify({ source, phone: isMobile, xThread }), signal: controller.signal,
      });
      if (!current()) return;
      if (res.alreadyKorean) { setTranslated(false); onNotice('이미 한국어로 된 글이에요.'); return; }
      setTranslation({ articleId: article.id, source, bodySource: res.bodySource, title: res.title, html: res.html, provider: res.provider, threadProof: xThread?.proof });
      setTranslated(true);
      if (res.notice) onNotice(res.notice);
    } catch (error) {
      if (current()) { setTranslated(false); setTranslationError(error instanceof Error && error.message ? error.message : '번역하지 못했어요. 다시 시도해 주세요.'); }
    } finally {
      if (translateRequest.current === controller) { translateRequest.current = null; setTranslating(false); }
    }
  };
  const toggleTranslation = () => {
    if (translating) { translateRequest.current?.abort(); translateRequest.current = null; setTranslating(false); return; }
    if (showTranslation) { setTranslated(false); return; }
    // 이미 받아 둔 번역은 다시 요청하지 않는다.
    const sameThread = !xPost || translationSource === 'feed' || !completeThread?.translationProof || completeThread.translationProof === translation?.threadProof;
    if (translation?.articleId === article.id && translation.source === translationSource && sameThread) { setTranslated(true); return; }
    void handleTranslate();
  };
  const translateAction = translating ? '번역 취소' : showTranslation ? '원문 보기' : '번역';
  const canOpenArticleInDeepL = !xPost || translationSource === 'feed' || Boolean(completeThread);
  /** 사용자의 DeepL 웹 번역기에 제목과 본문을 넘긴다. DeepL API 없이 로그인한 DeepL 계정으로 번역한다. */
  const openArticleInDeepL = () => {
    const body = xPost && translationSource === 'full' && completeThread?.html
      ? [...new DOMParser().parseFromString(completeThread.html, 'text/html').querySelectorAll('.post .text')].map(node => htmlToText(node.innerHTML)).join('\n\n')
      : htmlToText(article.full_content_html || article.content_html || `<p>${article.summary || ''}</p>`);
    openInDeepL(`${article.title}\n\n${body}`);
  };
  const translationFeedback = (translating || translationError) && <div className="feedex-translation-feedback" role={translating ? 'status' : 'alert'}>
    {translating && <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />}
    <span className="flex-1">{translating ? '한국어로 번역하는 중…' : translationError}</span>
    {translating ? <button type="button" onClick={toggleTranslation}>취소</button> : <>
      <button type="button" onClick={() => void handleTranslate()}>다시 시도</button>
      {canOpenArticleInDeepL && <button type="button" onClick={openArticleInDeepL}>DeepL에서 번역</button>}
      <button type="button" aria-label="번역 오류 닫기" onClick={() => setTranslationError('')}><X size={16} /></button>
    </>}
  </div>;

  const handleSummarizeAI = async (force = false) => {
    summaryRequest.current?.abort();
    const controller = new AbortController();
    summaryRequest.current = controller;
    const current = () => !controller.signal.aborted && summaryRequest.current === controller && currentSummaryScope.current === summaryScope;
    setAiOpen(true); setSummarizing(true); setSummaryError('');
    try {
      const xThread = xPost && completeThread?.translationProof
        ? { html: completeThread.html, proof: completeThread.translationProof } : undefined;
      const res = await apiRequest<{ aiSummary: string }>(`/api/articles/${article.id}/summarize`, {
        method: 'POST',
        body: JSON.stringify({ force, phone: isMobile, xThread }),
        signal: controller.signal,
      });
      // 닫거나 다른 글로 이동한 뒤 도착한 응답은 화면과 새 요청 상태를 바꾸지 않는다.
      if (!current()) return;
      onUpdateArticleFields(article.id, {
        ai_summary: res.aiSummary,
      });
    } catch (error) {
      if (current()) setSummaryError(error instanceof Error && error.message ? error.message : '기사 요약을 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (summaryRequest.current === controller) { summaryRequest.current = null; setSummarizing(false); }
    }
  };
  const toggleAiSummary = () => {
    if (aiOpen || summaryRequest.current) {
      summaryRequest.current?.abort(); summaryRequest.current = null;
      setAiOpen(false); setSummarizing(false);
    } else {
      setAiOpen(true);
      if (!currentAiSummary || (!xPost && mode !== 'feed' && !isCurrentSummary(currentAiSummary, 'full'))) void handleSummarizeAI();
    }
  };
  const aiAction = summarizing ? '요약 취소' : aiOpen ? '요약 닫기' : '요약';

  // 두 가지를 하나의 조절기로 다룬다: 피드·리더 보기에서는 글자 크기,
  // 웹 보기에서는 사이트 배율.
  const sizeControl = (className: string) => siteShown
    ? <div role="group" aria-label="사이트 확대·축소" className={className}>
        <button type="button" aria-label="사이트 축소" disabled={webZoom === WEB_ZOOM_STEPS[0]} onClick={() => changeWebZoom(-1)}><ZoomOut size={18} /></button>
        <button type="button" aria-label={`현재 ${Math.round(webZoom * 100)}%, 100%로 되돌리기`} onClick={() => changeWebZoom(0)}>{Math.round(webZoom * 100)}%</button>
        <button type="button" aria-label="사이트 확대" disabled={webZoom === WEB_ZOOM_STEPS[WEB_ZOOM_STEPS.length - 1]} onClick={() => changeWebZoom(1)}><ZoomIn size={18} /></button>
      </div>
    : <TextSizeControl className={className} />;

  const activeHtml =
    showingReader && article.full_content_html
      ? article.full_content_html
      : article.content_html || `<p>${article.summary || article.title}</p>`;


  /**
   * 휴대폰의 시스템 공유(카카오톡 등). 누른 그 순간에 바로 열어야 하므로 메뉴를 닫기 전에 부른다.
   * 열지 못하면(지원하지 않거나 막힌 경우) 아무 일도 없던 것처럼 끝내지 않고 링크를 복사해 둔다.
   */
  const shareWithDevice = (close: () => void) => {
    let shared: Promise<void>;
    try { shared = navigator.share({ title: article.title, url: article.url }); }
    catch (error) { shared = Promise.reject(error); }
    close();
    void shared.catch((error) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (shownArticleId.current === article.id) onCopyLink(article);
    });
  };
  const openShareLink = (url: string, close: () => void, linkEvent?: React.MouseEvent<HTMLAnchorElement>) => {
    const bridge = nativeBridge();
    if (bridge && url.startsWith('https://')) {
      linkEvent?.preventDefault();
      bridge.postMessage({ type: 'openExternal', url });
    } else if (linkEvent) {
      // Slap은 사용자가 누른 원래 링크를 브라우저나 운영체제가 설치 앱에 연결한다.
      window.setTimeout(close, 0);
      return;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    close();
  };
  /**
   * 공유 방법: 링크 복사 → Slap과 공유 사이트 → 이메일. 휴대폰(터치 화면)에서는 시스템 공유를 맨 위에 둔다.
   * 컴퓨터의 시스템 공유는 이메일 정도만 떠서 쓸모가 없으므로 데스크톱과 데스크톱 앱에서는 보이지 않는다.
   * 맥 앱은 메일 주소(mailto)를 열지 않으므로 이메일 공유를 뺀다.
   */
  const shareOptions = (close: () => void) => {
    const option = 'flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left hover:bg-emerald-500/10';
    const links = shareLinks(article);
    const phoneShare = isMobile && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
    return <>
      {phoneShare && <button type="button" className={option} onClick={() => shareWithDevice(close)}><Share2 size={16} aria-hidden="true" />다른 앱으로 공유</button>}
      <button type="button" className={option} onClick={() => { onCopyLink(article); close(); }}><Link2 size={16} aria-hidden="true" />링크 복사</button>
      <a className={option} href={links.slap} target="_blank" rel="noopener noreferrer" onClick={(event) => openShareLink(links.slap, close, event)}><MessageSquare size={16} aria-hidden="true" />Slap에 공유</a>
      {/* 기사 공유 메뉴의 버튼이 소셜 위젯을 숨기는 링크 선택자에 걸리지 않게 한다. */}
      <button type="button" className={option} onClick={() => openShareLink(links.x, close)}><ExternalLink size={16} aria-hidden="true" />X에 공유</button>
      <a className={option} href={links.threads} target="_blank" rel="noopener noreferrer" onClick={(event) => openShareLink(links.threads, close, event)}><AtSign size={16} aria-hidden="true" />Threads에 공유</a>
      <button type="button" className={option} onClick={() => openShareLink(links.telegram, close)}><Send size={16} aria-hidden="true" />텔레그램으로 공유</button>
      {nativePlatform() !== 'mac' && <a className={option} href={links.email} onClick={(event) => openShareLink(links.email, close, event)}><Mail size={16} aria-hidden="true" />이메일로 공유</a>}
    </>;
  };

  return (
    <div className="feedex-article-reader fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-auto h-full min-w-0 min-h-0 flex justify-end">
      {/* 배경 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity lg:hidden"
        onClick={onClose}
      />

      {/* 데스크톱의 본문 안 리더와 모바일의 전체 화면 리더 */}
      <div
        data-article-id={article.id}
        className={`feedex-reader relative z-10 w-full max-w-3xl lg:max-w-none h-full min-w-0 min-h-0 flex flex-col border-l lg:border-l-0 shadow-2xl lg:shadow-none overflow-hidden ${
          isDark
            ? 'bg-slate-950 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        <div ref={topRef} className="feedex-mobile-reader-top lg:hidden" data-scroll-hidden={barsHidden || undefined} inert={barsHidden || undefined} aria-hidden={barsHidden || undefined} onPointerDown={keepPeeking}>
          <button className="feedex-mobile-icon" onClick={onClose} aria-label="목록으로 돌아가기"><ChevronDown size={22} /></button>
          <div role="radiogroup" aria-label="본문 보기 방식" className="feedex-mobile-body-modes">{VIEW_MODES.map(({ id, label, Icon }) => <button key={id} role="radio" aria-label={label} aria-checked={mode === id} onClick={() => chooseViewMode(id)}>{id === 'reader' && scrapingReader ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}<span>{label}</span></button>)}</div>
          <button className="feedex-mobile-icon" aria-label="본문 도구" aria-expanded={mobileMenu === 'tools'} onClick={() => setMobileMenu('tools')}><MoreHorizontal size={20} /></button>
        </div>
        {/* 상단 동작 막대 */}
        <div
          className={`feedex-reader-toolbar px-4 sm:px-6 py-3 border-b flex flex-wrap items-center gap-2 shrink-0 ${
            isDark
              ? 'bg-slate-900/90 border-slate-800'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="feedex-reader-navigation flex shrink-0 items-center gap-1">
            <button type="button" onClick={onClose} aria-label="목록으로 돌아가기" title="목록으로 돌아가기" className={`feedex-reader-back feedex-reader-icon ${isDark ? 'border-slate-800 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-100'}`}><ArrowLeft className="w-4 h-4" /></button>

            {/* 읽음/안 읽음 전환 */}
            <button
              type="button"
              onClick={() => onToggleRead(article)}
              aria-label={article.is_read ? '안 읽음으로 표시' : '읽음으로 표시'}
              aria-pressed={article.is_read}
              title={article.is_read ? '안읽음으로 표시 (M)' : '읽음으로 표시 (M)'}
              className={`feedex-reader-icon ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {article.is_read ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Circle className="w-4 h-4" />
              )}
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => onNavigateRelative('prev')}
                aria-label="이전 아티클"
                title="이전 아티클 (↑)"
                className={`feedex-reader-icon disabled:opacity-30 ${
                  isDark
                    ? 'border-slate-800 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => onNavigateRelative('next')}
                aria-label="다음 아티클"
                title="다음 아티클 (↓)"
                className={`feedex-reader-icon disabled:opacity-30 ${
                  isDark
                    ? 'border-slate-800 text-slate-300 hover:bg-slate-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* 기사 새로고침 */}
            <button
              type="button"
              onClick={() => void refreshArticle()}
              disabled={refreshing}
              aria-label="기사 새로고침"
              title="기사 새로고침"
              className={`feedex-reader-icon disabled:cursor-default ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-emerald-400'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <RotateCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

          </div>

          {/* 글 도구 */}
          <div className={`feedex-reader-tools flex flex-wrap items-center gap-1 border-l pl-2 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
            {/* 저장 / 북마크 전환 */}
            <button
              type="button"
              onClick={() => onToggleSaved(article)}
              aria-label={article.is_saved ? '저장 취소' : '나중에 읽기'}
              aria-pressed={article.is_saved}
              title="나중에 읽기 북마크 (S)"
              className={`feedex-reader-icon ${
                article.is_saved
                  ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400'
                  : isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Bookmark
                className={`w-4 h-4 ${article.is_saved ? 'fill-current' : ''}`}
              />
            </button>

            {/* 글자 크기 (피드·리더 보기) */}
            {mode !== 'web' && <TextSizeControl />}

            {/* 웹 보기 배율 */}
            {mode === 'web' && (
              <div
                role="group"
                aria-label="사이트 확대·축소"
                className={`flex items-center rounded-xl border ${
                  isDark
                    ? 'bg-slate-900 border-slate-800 text-slate-300'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => changeWebZoom(-1)}
                  disabled={webZoom === WEB_ZOOM_STEPS[0]}
                  title="사이트 축소"
                  aria-label="사이트 축소"
                  className={`p-2 rounded-l-xl transition cursor-pointer disabled:opacity-30 disabled:cursor-default ${
                    isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'
                  }`}
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => changeWebZoom(0)}
                  title="100%로 되돌리기"
                  aria-label={`현재 ${Math.round(webZoom * 100)}%, 100%로 되돌리기`}
                  className={`min-w-[3rem] py-2 text-xs font-medium tabular-nums transition cursor-pointer ${
                    isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'
                  }`}
                >
                  {Math.round(webZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => changeWebZoom(1)}
                  disabled={webZoom === WEB_ZOOM_STEPS[WEB_ZOOM_STEPS.length - 1]}
                  title="사이트 확대"
                  aria-label="사이트 확대"
                  className={`p-2 rounded-r-xl transition cursor-pointer disabled:opacity-30 disabled:cursor-default ${
                    isDark ? 'hover:bg-slate-800' : 'hover:bg-slate-100'
                  }`}
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* 링크 복사 */}
            <button
              type="button"
              onClick={() => onCopyLink(article)}
              aria-label="링크 복사"
              title="링크 복사 (C)"
              className={`feedex-reader-icon ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-emerald-400'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Link2 className="w-4 h-4" />
            </button>

            <button type="button" aria-label="글 공유" title="글 공유" aria-expanded={shareDialogOpen} aria-haspopup="dialog" onClick={openShare}
              className={`feedex-reader-icon ${isDark ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}>
              <Share2 className="w-4 h-4" />
            </button>

            {/* 원문 링크 열기 */}
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="원문 사이트 새 탭에서 열기"
              title="원문 사이트 새 탭에서 열기 (O)"
              className={`feedex-reader-icon ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-emerald-400'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <ExternalLink className="w-4 h-4" />
            </a>

            {/* 번역 버튼 */}
            <button
              type="button"
              onClick={toggleTranslation}
              aria-label={translateAction}
              aria-pressed={showTranslation}
              title={translateAction}
              className={`feedex-reader-icon ${showTranslation
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                : isDark ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-emerald-400' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'}`}
            >
              {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            </button>

            {/* AI 요약 버튼 */}
            <button
              type="button"
              onClick={toggleAiSummary}
              aria-label={aiAction}
              aria-pressed={aiOpen}
              title={aiAction}
              className={`shrink-0 h-8 px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 border transition cursor-pointer ${
                aiOpen
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-emerald-500 hover:bg-emerald-400 border-emerald-500 text-slate-950 shadow-xs'
              }`}
            >
              {summarizing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span className="feedex-reader-control-label">요약</span>
            </button>
          </div>

          {/* 본문 보기: 피드 본문 / 리더(전체 기사) / 웹 페이지 */}
          <div
            role="radiogroup"
            aria-label="본문 보기 방식"
            className={`feedex-reader-view ml-auto flex shrink-0 items-center rounded-xl border p-0.5 ${
              isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            {VIEW_MODES.map(({ id, label, title, Icon }) => {
              const selected = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-label={label}
                  aria-checked={selected}
                  title={title}
                  onClick={() => chooseViewMode(id)}
                  className={`h-7 px-2 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1 transition cursor-pointer ${
                    selected
                      ? isDark
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-900 text-white'
                      : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {id === 'reader' && scrapingReader ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  <span className="feedex-reader-control-label">{label}</span>
                </button>
              );
            })}
          </div>

        </div>

        {siteShown ? (
          <div ref={webViewRef} className="feedex-web-view relative flex-1 min-h-0 flex flex-col" data-scroll-hidden={barsHidden || undefined} data-framed={framed || undefined}>
            {/* 웹 보기에서는 사이트 위에 요약을 접을 수 있는 칸으로 둔다. 길면 이 칸 안에서 스크롤한다. */}
            {aiOpen && (currentAiSummary || summarizing || summaryError) && <div className="feedex-web-summary">
              <AiSummaryCard isDark={isDark} summarizing={summarizing} summary={currentAiSummary} error={summaryError} onRegenerate={() => handleSummarizeAI(true)} onClose={toggleAiSummary} loadingLabel={xPost ? 'X 대화를 요약하는 중…' : undefined} />
            </div>}
            {translationFeedback}
            {nativeWeb ? (<>
              <WebStatusBar key={article.id} url={article.url} isDark={isDark} hidden={false} canLogin={false} notice={article.url} shortNotice={siteHost(article.url)}>
                <button type="button" onClick={() => nativeBridge()?.postMessage({ type: 'openExternal', url: article.url })} className="inline-flex items-center gap-1 hover:underline">
                  <WebLabel short="브라우저" long="브라우저에서 열기" /><ExternalLink className="w-3 h-3" aria-hidden="true" />
                </button>
              </WebStatusBar>
              {/* 맥 앱이 이 자리에 원문 화면을 겹쳐 띄운다. */}
              <div ref={nativeSlotRef} data-native-article className="relative flex-1 min-h-0 bg-white" />
            </>) : (<>
            <WebStatusBar
              key={article.id}
              url={article.url}
              isDark={isDark}
              hidden={barsHidden}
              canLogin={!xPost}
              busy={webPreviewShown || frameLoading}
              notice={webStatus?.notice ?? ''}
              shortNotice={webStatus?.short ?? ''}
              onLeave={onLeaveForOriginal}
            >
              {webCopyShown && !xWaiting && webCopy?.textOnly && <button type="button" onClick={showWebCopy} className="hover:underline"><WebLabel short="원래 모양" long="원래 모양 다시 받기" /></button>}
              {webCopyShown && !copyFor?.retrying && (copyFor?.partial || (xWaiting && xFailed)) && <button type="button" onClick={showWebCopy} disabled={refreshing} className="hover:underline">다시 시도</button>}
              {webFrameShown && <button type="button" onClick={showWebCopy} className="hover:underline"><WebLabel short={isDark ? "다크 사본" : "사본으로"} long={isDark ? "다크 웹 사본으로 보기" : "웹 사본으로 보기"} /></button>}
              {/* X 글은 공개 미러로 보여 주므로, 로그인한 상태로 보려면 X에서 연다. 다른 글의 원문은 막대가 이 창에서 연다. */}
              {webStatus?.xUrl && (
                <a href={webStatus.xUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  X에서 열기<ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </WebStatusBar>
            {webCopyShown ? (
              <>
                <WebPager enabled={isMobile} onBack={onClose}>
                <div className="relative flex-1 min-h-0 overflow-hidden feedex-web-frame">
                  {/*
                    * 스크립트는 스크롤 알림용으로만 돈다. 사본은 정리돼 있고 보안 정책이 나머지를 막는다.
                    * allow-same-origin이 없으므로 앱에 닿을 수 없고, X 글 링크는 앱에 알리고, 나머지 링크는 새 탭에서 연다.
                    */}
                  {/* 완성된 사본은 새 프레임에서 그린다. 미리보기 프레임이 다 그릴 때까지 위를 덮고 있다. */}
                  {!xWaiting && (
                    <iframe
                      ref={copyRef}
                      key={`copy-${article.id}-ready`}
                      srcDoc={copyHtml}
                      onLoad={() => { insetCopy.current(); setHoldingPreview(null); }}
                      title={article.title}
                      className="absolute left-0 top-0 border-0 feedex-web-frame"
                      style={copyFrameStyle}
                      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {/* 미리보기 프레임. 사본이 도착해도 같은 프레임을 그대로 두므로 다시 불러오지 않는다. */}
                  {(xWaiting || holdingPreview?.articleId === article.id) && (
                    <iframe
                      ref={xWaiting ? copyRef : undefined}
                      key={`copy-${article.id}-preview`}
                      srcDoc={xWaiting ? xPreview : holdingPreview!.html}
                      onLoad={xWaiting ? () => insetCopy.current() : undefined}
                      title={article.title}
                      aria-hidden={xWaiting ? undefined : true}
                      tabIndex={xWaiting ? undefined : -1}
                      className="absolute left-0 top-0 border-0 feedex-web-frame"
                      style={xWaiting ? copyFrameStyle : { ...copyFrameStyle, zIndex: 1, pointerEvents: 'none' }}
                      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  {activeYouTube && (
                    <div
                      ref={ytOverlayRef}
                      className="absolute z-10 overflow-hidden rounded-xl bg-black shadow-lg"
                      style={{
                        left: `${activeYouTube.rect[0] * webZoom}px`,
                        top: `${activeYouTube.rect[1] * webZoom}px`,
                        width: `${activeYouTube.rect[2] * webZoom}px`,
                        height: `${activeYouTube.rect[3] * webZoom}px`,
                      }}
                    >
                      <iframe
                        key={`${activeYouTube.id}:${activeYouTube.start}`}
                        src={youtubeEmbedSrc(activeYouTube.id, activeYouTube.start, true)}
                        title="YouTube 동영상"
                        className="h-full w-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                      <button
                        type="button"
                        onClick={closeYouTube}
                        aria-label="동영상 닫기"
                        title="동영상 닫기"
                        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/80 text-xs font-bold text-white hover:bg-slate-900 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                </WebPager>
              </>
            ) : !frame || frame.articleId !== article.id ? (
              <WebLoading />
            ) : frame.embeddable ? (
              <>
                <WebPager enabled={isMobile} onBack={onClose}>
                <div ref={framePaneRef} className="relative flex-1 min-h-0 overflow-hidden feedex-web-frame">
                  <iframe
                    key={`${article.id}:${frameReloads}`}
                    src={frame.url}
                    title={article.title}
                    className="absolute left-0 top-0 border-0 feedex-web-frame"
                    style={{ ...frameScaleStyle(webZoom * fixedLayoutFit(frame.layoutWidth, framePaneWidth)), colorScheme: isDark ? 'dark' : 'light' }}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-storage-access-by-user-activation"
                    onError={showWebCopy}
                    onLoad={() => setLoadedFrame(article.id)}
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                  {frameLoading && <WebLoading overlay />}
                </div>
                </WebPager>
              </>
            ) : webCopy?.articleId !== article.id ? (
              <WebLoading />
            ) : (
              <div className="feedex-web-fill flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
                <Globe className="w-9 h-9 text-slate-400" aria-hidden="true" />
                <p className={`text-sm ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                  {webCopy?.articleId === article.id && webCopy.error ? webCopy.error : frame.reason === 'challenge' ? '사이트의 보안 확인 때문에 웹 보기를 열 수 없어요.' : frame.reason === 'http' ? '사이트에서 페이지를 불러오지 못했어요.' : '이 사이트는 다른 서비스 안에서 열리지 않도록 막아 두었어요.'}
                </p>
                {webCopy?.articleId === article.id && webCopy.retrying && <p className={`-mt-2 text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>사이트가 잠깐 막은 것일 수 있어요. 이 글을 보고 계시는 동안 잠시 뒤 자동으로 다시 받아 볼게요.</p>}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button type="button" className="feedex-cache-clear" onClick={showWebCopy}>웹 사본 다시 시도</button>
                  <button type="button" className="feedex-cache-clear" onClick={() => setFrame({ articleId: article.id, embeddable: true, url: article.url })}>원본 다시 표시</button>
                  <a
                    href={frame.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    새 창에서 열기
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => chooseViewMode('reader')}
                    className={`px-4 py-2 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition cursor-pointer ${
                      isDark
                        ? 'border-slate-700 text-slate-200 hover:bg-slate-800'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    리더로 보기
                  </button>
                </div>
              </div>
            )}
            </>)}
          </div>
        ) : (
        <div ref={bodyRef} tabIndex={0} aria-label="본문 내용" className="feedex-reader-content flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-8 py-6 space-y-6">
          {translationFeedback}
          {article.body_deferred && <div role="status" className="flex items-center gap-2 text-sm text-slate-400">{article.body_load_error ? <><span>본문을 가져오지 못했습니다.</span><button className="text-emerald-500" onClick={() => onUpdateArticleFields(article.id, { body_load_error: false })}>다시 시도</button></> : <><Loader2 size={16} className="animate-spin" /><span>본문 불러오는 중…</span></>}</div>}
          {/* 글 정보 머리글 */}
          <div className="space-y-3 border-b pb-6 border-slate-800/60">
            <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-400 font-medium">
              {article.feed_favicon ? (
                <img
                  src={article.feed_favicon}
                  alt=""
                  className="w-4 h-4 rounded-sm"
                />
              ) : (
                <Rss className="w-4 h-4" />
              )}
              <span>{article.feed_title}</span>
              {article.folder_name && (
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {article.folder_name}
                </span>
              )}
              <span className="text-slate-500">·</span>
              <span className="text-slate-400" title={article.date_source === 'original' ? '원문 발행일' : '피드에서 제공한 발행일'}>
                {checkingDate ? '원문 발행일 확인 중…' : article.date_source === 'updated' || article.date_source === 'collected' ? '발행일 미제공' : <>
                {article.date_source !== 'original' && '피드 제공 · '}
                {new Date(article.published_at).toLocaleString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                ({formatRelativeTime(article.published_at)})
                </>}
              </span>
              {article.author && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300">{article.author}</span>
                </>
              )}
            </div>

            <h1
              className={`text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {showTranslation ? translation!.title : article.title}
            </h1>
          </div>

          {/* 번역해서 보여 주는 중이라는 표시. 누르면 원문으로 돌아간다. */}
          {showTranslation && <div role="status" className={`feedex-translation-bar ${isDark ? 'border-emerald-500/30 text-emerald-300' : 'border-emerald-200 text-emerald-800'}`}>
            <Languages className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{translation!.source === 'full' && translation!.bodySource === 'feed' ? '피드 본문만 번역' : `${translation!.provider === 'deepl' ? 'DeepL' : 'Workers AI'} 번역`}</span>
            {canOpenArticleInDeepL && translation!.provider !== 'deepl' && <button type="button" onClick={openArticleInDeepL} className="shrink-0 whitespace-nowrap font-semibold hover:underline cursor-pointer">DeepL에서 보기</button>}
            <button type="button" onClick={() => setTranslated(false)} className="shrink-0 whitespace-nowrap font-semibold hover:underline cursor-pointer">원문 보기</button>
          </div>}

          {/* Cloudflare Workers AI 요약 카드 */}
          {aiOpen && (currentAiSummary || summarizing || summaryError) && <AiSummaryCard isDark={isDark} summarizing={summarizing} summary={currentAiSummary} error={summaryError} onRegenerate={() => handleSummarizeAI(true)} loadingLabel={xPost ? 'X 대화를 요약하는 중…' : undefined} />}

          {/* 대표 썸네일 이미지 (contentHtml에 이미 들어 있지 않을 때) */}
          {article.thumbnail_url &&
            !bodyShowsImage(activeHtml, article.thumbnail_url) && (
              <div className="rounded-2xl overflow-hidden border border-slate-800/60">
                <img
                  src={shownThumbnail(article.thumbnail_url, article) || undefined}
                  alt={article.title}
                  className="w-full max-h-96 object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

          {/* 리더 보기 상태: 불러오는 중이거나 피드 본문으로 대신 보여 주는 중 */}
          {mode === 'reader' && !showingReader && (scrapingReader || (readerFailed && !bodyless)) && (
            <div
              className={`px-3.5 py-2 rounded-xl border text-xs flex items-center gap-2 ${
                isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'
              }`}
            >
              {scrapingReader ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{bodyless ? '원문에서 본문을 불러오는 중이에요.' : '원문에서 전체 본문을 불러오는 중이에요. 그동안 피드 본문을 보여드려요.'}</span>
                </>
              ) : (
                <span>원문 전체 본문을 불러오지 못해 피드 본문을 보여드려요.</span>
              )}
            </div>
          )}

          {/* 본문 HTML. 피드에 본문이 없으면 어디서 읽을 수 있는지 안내한다 */}
          {bodyless && !showTranslation ? (
            !scrapingReader && (
              <div className={`rounded-2xl border p-6 text-center ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                <p className="text-sm font-semibold">{readerFailed ? '원문 본문을 불러오지 못했어요' : '이 글은 피드에 본문이 없어요'}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {readerFailed
                    ? '사이트에서 본문을 가져오지 못했습니다. 잠시 후 다시 시도하거나 원문 사이트에서 읽어 주세요.'
                    : '원문 사이트에서 읽거나, 리더 보기로 본문을 불러와 보세요.'}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                  >
                    <span>원문 사이트에서 읽기</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  {(mode !== 'reader' || readerFailed) && (
                    <button
                      type="button"
                      onClick={() => chooseViewMode('reader')}
                      className={`px-4 py-2 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}`}
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{readerFailed ? '본문 다시 불러오기' : '리더로 보기'}</span>
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <ArticleBody
              html={showTranslation ? translation!.html : activeHtml}
              onOpenXPost={xPost ? onOpenXPost : undefined}
              base={article.url}
              title={showingXTranslation ? undefined : showTranslation ? translation!.title : showingReader ? article.title : undefined}
              style={{ fontSize: `calc(var(--feedex-article-font) * ${fontScale})` }}
              className={`feedex-article-content ${
                isDark ? 'text-slate-200' : 'text-slate-800'
              }`}
            />
          )}

          {/* 아래쪽 원문 기사 안내 */}
          <div
            className={`mt-10 pt-6 border-t flex flex-wrap items-center justify-between gap-4 ${
              isDark ? 'border-slate-800' : 'border-slate-200'
            }`}
          >
            <div className="text-xs text-slate-400">
              원문 출처: <span className="font-medium">{article.feed_title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 transition"
              >
                <span>원문 사이트에서 보기</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
        )}
        {framed && barsHidden && <button type="button" className="feedex-web-peek lg:hidden" aria-label="메뉴 보이기" onClick={() => setPeek(1)}><ChevronUp size={22} /></button>}
        <nav aria-label="본문 조작" className="feedex-mobile-dock feedex-mobile-reader-dock lg:hidden" data-scroll-hidden={barsHidden || undefined} inert={barsHidden || undefined} aria-hidden={barsHidden || undefined} onPointerDown={keepPeeking}>
          <button aria-label={article.is_read ? '안 읽음으로 표시' : '읽음으로 표시'} aria-pressed={article.is_read} onClick={() => onToggleRead(article)}>{article.is_read ? <CheckCircle2 size={19} /> : <Circle size={19} />}</button>
          <button aria-label={article.is_saved ? '저장 취소' : '나중에 읽기'} aria-pressed={article.is_saved} onClick={() => onToggleSaved(article)}><Bookmark size={19} fill={article.is_saved ? 'currentColor' : 'none'} /></button>
          <button aria-label="이전 아티클" disabled={!hasPrev} onClick={() => onNavigateRelative('prev')}><ChevronLeft size={21} /></button>
          <button aria-label="다음 아티클" disabled={!hasNext} onClick={() => onNavigateRelative('next')}><ChevronRight size={21} /></button>
          <button aria-label="글 공유" aria-expanded={shareDialogOpen || mobileMenu === 'share'} onClick={openShare}><Share2 size={18} /></button>
          <button aria-label="번역 및 AI 요약" aria-expanded={mobileMenu === 'assist'} onClick={() => setMobileMenu('assist')}>{translating || summarizing ? <Loader2 size={19} className="animate-spin" /> : <Sparkles size={19} />}</button>
        </nav>
        {shareDialogOpen && <dialog ref={shareDialogRef} aria-label="공유 방법" onCancel={(event) => { event.preventDefault(); closeShareDialog(); }}
          onClick={(event) => { if (event.target === event.currentTarget) closeShareDialog(); }}
          className={`feedex-desktop-share-menu fixed inset-0 m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-sm overflow-y-auto rounded-2xl border text-sm shadow-2xl backdrop:bg-black/45 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`}>
          <div className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">글 공유</h2>
              <button type="button" aria-label="공유 닫기" className="rounded-lg p-2 hover:bg-emerald-500/10" onClick={closeShareDialog}><X size={17} /></button>
            </div>
            <div className="grid gap-1 min-[350px]:grid-cols-2">{shareOptions(closeShareDialog)}</div>
          </div>
        </dialog>}
        {isMobile && mobileMenu && <>
          <button type="button" className="feedex-reader-menu-backdrop" aria-label="메뉴 닫기" onClick={closeMobileMenu} />
          {mobileMenu === 'tools' ? <div className="feedex-mobile-reader-menu" aria-label="본문 도구">
            {/* 위쪽 ... 메뉴에서도 요약을 바로 열 수 있게 맨 위에 둔다. 아래 막대의 번역·요약 메뉴와 같은 동작이다. */}
            <button aria-pressed={aiOpen} onClick={() => { closeMobileMenu(); toggleAiSummary(); }}>{summarizing ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}{aiAction}</button>
            {canOpenArticleInDeepL && <button onClick={() => { closeMobileMenu(); openArticleInDeepL(); }}><ExternalLink size={18} />DeepL에서 번역</button>}
            <button disabled={refreshing} onClick={() => { closeMobileMenu(); void refreshArticle(); }}><RotateCw size={18} className={refreshing ? 'animate-spin' : undefined} />기사 새로고침</button>
            <p className="feedex-mobile-menu-label">{siteShown ? '사이트 확대·축소' : '글자 크기'}</p>
            {sizeControl('feedex-mobile-zoom')}
            <a href={article.url} target="_blank" rel="noopener noreferrer" onClick={closeMobileMenu}><ExternalLink size={18} />원문 사이트 열기</a>
          </div> : mobileMenu === 'share' ? <div role="group" className="feedex-mobile-reader-menu feedex-mobile-assist-menu feedex-mobile-share-menu" aria-label="공유 방법">
            {shareOptions(closeMobileMenu)}
          </div> : <div className="feedex-mobile-reader-menu feedex-mobile-assist-menu" aria-label="번역 및 AI 요약">
            <button aria-pressed={showTranslation} onClick={() => { closeMobileMenu(); toggleTranslation(); }}>{translating ? <Loader2 size={18} className="animate-spin" /> : <Languages size={18} />}{translateAction}</button>
            <button aria-pressed={aiOpen} onClick={() => { closeMobileMenu(); toggleAiSummary(); }}><Sparkles size={18} />{aiAction}</button>
          </div>}
        </>}
      </div>
    </div>
  );
};
