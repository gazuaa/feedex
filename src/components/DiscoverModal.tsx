import React, { useState } from 'react';
import {
  X,
  Compass,
  Plus,
  Check,
  Search,
  FileCode2,
  Download,
  Loader2,
  Eye,
  Rss,
  Users,
} from 'lucide-react';
import { FeedPreview } from './FeedPreview';
import { OpmlImporter } from './OpmlImporter';
import { XFollowingImporter } from './XFollowingImporter';
import { RssBuilder } from './RssBuilder';
import { SubscribeFolderStep, type FolderChoice } from './SubscribeFolderStep';
import { matchesFeedSearch, normalizeFeedUrl } from '../shared/feedDiscovery';
import { xProfile } from '../shared/xFeed';
import type { BuilderSite } from '../shared/rssBuilder';
import {
  apiRequest,
  getStoredToken,
  type CuratedFeedItem,
  type FolderItem,
  type SubscriptionItem,
  type FeedPreviewResponse,
} from '../client/api';

interface DiscoverModalProps {
  isOpen: boolean;
  initialTab: 'curated' | 'opml' | 'x';
  onClose: () => void;
  curatedFeeds: CuratedFeedItem[];
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  onSubscribed: () => Promise<void>;
  isDark: boolean;
}

export const DiscoverModal: React.FC<DiscoverModalProps> = ({
  isOpen,
  initialTab,
  onClose,
  curatedFeeds,
  folders,
  subscriptions,
  onSubscribed,
  isDark,
}) => {
  const [tab, setTab] = useState<'curated' | 'opml' | 'x'>(initialTab);
  const [selectedCategory, setSelectedCategory] = useState<string>('전체');
  const [previewFeed, setPreviewFeed] = useState<CuratedFeedItem | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [urlPreview, setUrlPreview] = useState<FeedPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderBusy, setBuilderBusy] = useState(false);
  const [urlFeedOpen, setUrlFeedOpen] = useState(false);
  const [site, setSite] = useState<BuilderSite | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState<CuratedFeedItem | null>(null);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);
  const [opmlImporting, setOpmlImporting] = useState(false);
  const [xImporting, setXImporting] = useState(false);
  const modalBusy = opmlImporting || builderBusy || xImporting;
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  React.useEffect(() => {
    setTab(initialTab);
    setFeedback(null);
    setPreviewFeed(null);
    setQuery('');
    setUrlPreview(null);
    setPreviewError(null);
    setSubscribeTarget(null);
    setBuilderOpen(false);
    setUrlFeedOpen(false);
  }, [initialTab, isOpen]);

  const previewUrl = normalizeFeedUrl(query);
  React.useEffect(() => {
    setUrlPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    if (!isOpen || tab !== 'curated' || !previewUrl || builderOpen) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      apiRequest<FeedPreviewResponse>('/api/discover/preview', {
        method: 'POST', signal: controller.signal, body: JSON.stringify({ url: previewUrl }),
      }).then((result) => {
        if (!controller.signal.aborted) setUrlPreview(result);
      }).catch((error) => {
        if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : '피드를 불러오지 못했습니다.');
      }).finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, previewUrl, previewRetry, isOpen, tab, builderOpen]);

  // 만들기 도구는 웹사이트를 대상으로 한다. 피드 주소면 그 사이트 페이지를 쓴다.
  const builderUrl = previewUrl && xProfile(previewUrl) ? null : urlPreview?.feed.htmlUrl && normalizeFeedUrl(urlPreview.feed.xmlUrl) === previewUrl
    ? normalizeFeedUrl(urlPreview.feed.htmlUrl) || previewUrl
    : previewUrl;
  React.useEffect(() => {
    setSite(null);
    if (!isOpen || tab !== 'curated' || !builderUrl || previewLoading) return;
    const controller = new AbortController();
    apiRequest<BuilderSite>('/api/rss-builder/site', { method: 'POST', signal: controller.signal, body: JSON.stringify({ url: builderUrl }) })
      .then((result) => { if (!controller.signal.aborted) setSite(result); })
      .catch(() => {});
    return () => controller.abort();
  }, [builderUrl, previewLoading, isOpen, tab]);

  React.useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [previewFeed, urlFeedOpen, subscribeTarget, tab, builderOpen]);

  if (!isOpen) return null;

  const categories = [
    '전체',
    ...Array.from(new Set(curatedFeeds.map((f) => f.category))),
  ];

  const filteredCurated = curatedFeeds.filter((feed) =>
    (selectedCategory === '전체' || feed.category === selectedCategory) && matchesFeedSearch(feed, query));

  const resolvedFeed: CuratedFeedItem | null = urlPreview ? {
    id: `url:${urlPreview.feed.xmlUrl}`, title: urlPreview.feed.title,
    xmlUrl: urlPreview.feed.xmlUrl, htmlUrl: urlPreview.feed.htmlUrl || urlPreview.feed.xmlUrl,
    description: urlPreview.feed.description || '', category: '', tags: [], language: 'KO', folderSuggest: '',
  } : null;
  const shownFeed = (urlFeedOpen ? resolvedFeed : null) || previewFeed;

  const isSubscribedUrl = (xmlUrl: string) =>
    subscriptions.some(
      (s) => s.xml_url.toLowerCase() === xmlUrl.toLowerCase()
    );

  const handleSubscribe = async (feed: CuratedFeedItem, choice: FolderChoice) => {
    setBusyUrl(feed.xmlUrl);
    setSubscribeError(null);
    setFeedback(null);
    try {
      await apiRequest('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          url: feed.xmlUrl,
          folderId: choice.folderId ?? null,
          folderName: choice.folderName ?? null,
          customTitle: choice.title !== feed.title ? choice.title : null,
        }),
      });
      await onSubscribed();
      const folderName = choice.folderId ? folders.find((folder) => folder.id === choice.folderId)?.name : choice.folderName;
      setFeedback({
        type: 'success',
        text: `"${choice.title}" 피드를 ${folderName ? `[${folderName}] 폴더에` : '미분류로'} 구독했습니다.`,
      });
      setSubscribeTarget(null);
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : '구독하지 못했습니다.');
    } finally {
      setBusyUrl(null);
    }
  };

  const handleExportOpml = () => {
    const token = getStoredToken();
    const url = `/api/opml/export${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`;
    window.open(url, '_blank');
  };

  const subscribeButton = (feed: CuratedFeedItem) => {
    const subscribed = isSubscribedUrl(feed.xmlUrl);
    return (
      <button
        type="button"
        disabled={subscribed || busyUrl !== null}
        onClick={() => { setSubscribeError(null); setFeedback(null); setSubscribeTarget(feed); }}
        className={`relative z-10 pointer-events-auto px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1 transition cursor-pointer shrink-0 disabled:cursor-default ${
          subscribed
            ? 'bg-emerald-500/15 text-emerald-400'
            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
        }`}
      >
        {busyUrl === feed.xmlUrl ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>구독 중…</span></>
        ) : subscribed ? (
          <><Check className="w-3.5 h-3.5" /><span>구독 중</span></>
        ) : (
          <><Plus className="w-3.5 h-3.5" /><span>구독하기</span></>
        )}
      </button>
    );
  };

  const hostname = (value: string) => { try { return new URL(value).hostname; } catch { return value; } };
  const favicon = (value: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(value))}&sz=64`;
  const cardSurface = isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200';

  // 추천 피드에는 분류·언어·태그가 있다. 주소로 찾은 피드는 대신 그 주소를 보여 준다.
  const feedCard = (feed: CuratedFeedItem, onOpen: () => void) => (
    <div key={feed.id} className={`relative group p-4 rounded-2xl border flex flex-col justify-between gap-3 transition hover:border-emerald-500/50 ${cardSurface}`}>
      <button
        type="button"
        aria-label={`${feed.title} 미리보기`}
        onClick={onOpen}
        className="absolute inset-0 rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-emerald-500 focus-visible:outline-offset-2"
      />
      <div className="relative pointer-events-none">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <img src={favicon(feed.htmlUrl)} alt="" className="w-4 h-4 rounded-sm shrink-0" />
            <h3 className="font-bold text-sm truncate">{feed.title}</h3>
          </div>
          {feed.category && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${feed.language === 'KO' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'}`}>
              {feed.language}
            </span>
          )}
        </div>
        {!feed.category && <p className="text-[11px] text-slate-500 truncate mb-1.5">{feed.xmlUrl}</p>}
        {feed.description && <p className="text-xs text-slate-400 leading-relaxed mb-3 line-clamp-3">{feed.description}</p>}
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500 group-hover:text-emerald-400">
          <Eye className="w-3.5 h-3.5" /> 최근 글 미리보기
        </span>
      </div>

      <div className={`relative pointer-events-none flex items-center gap-2 pt-2 border-t ${isDark ? 'border-slate-800/50' : 'border-slate-200'} ${feed.tags.length ? 'justify-between' : 'justify-end'}`}>
        {feed.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {feed.tags.slice(0, 3).map((tag) => (
              <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-slate-800/80 text-slate-400' : 'bg-slate-200/80 text-slate-500'}`}>#{tag}</span>
            ))}
          </div>
        )}
        {subscribeButton(feed)}
      </div>
    </div>
  );

  // Feedly처럼, 주소 검색 결과가 무엇이든 웹사이트에 실린 글 목록으로
  // 피드를 만들어 보라고 권한다.
  const builderSuggestion = builderUrl && (
    <section aria-labelledby="builder-suggestion-title" className={`rounded-2xl border p-4 sm:p-5 ${cardSurface}`}>
      <h3 id="builder-suggestion-title" className="text-sm font-bold">원하는 피드가 없나요?</h3>
      <p className="mt-1 text-xs text-slate-400">이 웹사이트에 올라온 글로 맞춤 RSS 피드를 만들 수 있습니다.</p>
      <div className={`mt-4 flex gap-3 sm:gap-4 rounded-xl border p-4 ${isDark ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-white'}`}>
        <img src={favicon(site?.url || builderUrl)} alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 className="min-w-0 text-sm font-bold">{site?.title || hostname(builderUrl).replace(/^www\./, '')}</h4>
            <button type="button" onClick={() => { setFeedback(null); setBuilderOpen(true); }} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/60 text-emerald-500 hover:bg-emerald-500/10 text-xs font-semibold cursor-pointer">
              <Rss className="w-3.5 h-3.5" />RSS 피드 만들기
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 truncate">{(site?.url || builderUrl).replace(/^https?:\/\/(?:www\.)?/, '')}</p>
          {site?.description && <p className="mt-2 text-xs text-slate-400 leading-relaxed line-clamp-3">{site.description}</p>}
        </div>
      </div>
    </section>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-xs"
        onClick={() => { if (!modalBusy) onClose(); }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="discovery-title"
        className={`relative z-10 w-full ${builderOpen ? 'max-w-5xl' : 'max-w-3xl'} h-dvh sm:h-auto sm:max-h-[88dvh] sm:rounded-2xl sm:border shadow-2xl flex flex-col overflow-hidden ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* 창 머리글 */}
        <div
          className={`sfeed-discover-header px-4 sm:px-6 py-3 sm:py-4 shrink-0 border-b flex items-center justify-between gap-3 ${
            isDark ? 'border-slate-800 bg-slate-950/60' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 id="discovery-title" className="text-base font-bold">
                피드 추가
              </h2>
              <p className="hidden sm:block text-xs text-slate-400">
                피드 이름이나 RSS·웹사이트 주소를 검색하고 미리본 뒤 구독하세요
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="닫기"
            disabled={modalBusy}
            onClick={() => { if (!modalBusy) onClose(); }}
            className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 창 탭 */}
        <div
          className={`px-4 sm:px-6 pt-3 shrink-0 border-b flex items-center gap-2 overflow-x-auto ${
            isDark ? 'border-slate-800' : 'border-slate-200'
          }`}
        >
          <button
            type="button"
            disabled={modalBusy}
            onClick={() => { setTab('curated'); setPreviewFeed(null); }}
            className={`px-3 sm:px-4 py-2.5 shrink-0 whitespace-nowrap text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              tab === 'curated'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>피드 검색 · 추가</span>
          </button>

          <button
            type="button"
            disabled={modalBusy}
            onClick={() => setTab('opml')}
            className={`px-3 sm:px-4 py-2.5 shrink-0 whitespace-nowrap text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              tab === 'opml'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode2 className="w-4 h-4" />
            <span>OPML<span className="hidden sm:inline"> 가져오기 / 내보내기</span></span>
          </button>
          <button type="button" disabled={modalBusy} onClick={() => setTab('x')} className={`px-3 sm:px-4 py-2.5 shrink-0 whitespace-nowrap text-xs font-semibold border-b-2 flex items-center gap-1.5 cursor-pointer ${tab === 'x' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400'}`}>
            <Users className="w-4 h-4" /><span>X 팔로우</span>
          </button>
        </div>

        {/* 안내 띠 */}
        {feedback && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl text-xs font-medium border ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* 창 본문 */}
        <div ref={bodyRef} className="sfeed-discover-body flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {/* 피드 검색과 주소 미리 보기를 한곳에서 */}
          {tab === 'curated' && <form role="search" aria-label="피드 검색" onSubmit={(event) => { event.preventDefault(); if (previewUrl) setPreviewRetry((value) => value + 1); }} className="mb-5">
            <label htmlFor="feed-discovery-search" className="sr-only">피드 이름 또는 RSS·웹사이트 주소</label>
            <div className="relative">
              <Search aria-hidden="true" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input id="feed-discovery-search" type="search" value={query} disabled={busyUrl !== null || builderBusy} onChange={(event) => { setQuery(event.target.value); setBuilderOpen(false); setUrlFeedOpen(false); setSubscribeTarget(null); setPreviewFeed(null); setUrlPreview(null); setPreviewError(null); setFeedback(null); }} placeholder="피드 이름, 웹사이트·RSS 주소 또는 @X계정" autoComplete="off" className={`w-full pl-10 pr-4 py-3 rounded-xl text-sm border focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'}`} />
            </div>
            <p className="text-[11px] text-slate-400 mt-2">이름으로 추천 피드를 찾거나, 주소를 입력해 최근 글을 미리보세요.</p>
          </form>}
          {tab === 'curated' && (
            builderOpen && builderUrl ? <RssBuilder key={builderUrl} url={builderUrl} folders={folders} isDark={isDark} onBack={() => setBuilderOpen(false)} onSubscribed={onSubscribed} onBusyChange={setBuilderBusy} /> : subscribeTarget ? (
              <SubscribeFolderStep
                key={subscribeTarget.id}
                feedTitle={subscribeTarget.title}
                siteUrl={subscribeTarget.htmlUrl}
                folders={folders}
                suggestedFolder={subscribeTarget.folderSuggest || undefined}
                isDark={isDark}
                busy={busyUrl === subscribeTarget.xmlUrl}
                error={subscribeError}
                onBack={() => setSubscribeTarget(null)}
                onConfirm={(choice) => handleSubscribe(subscribeTarget, choice)}
              />
            ) : shownFeed ? (
              <FeedPreview
                key={shownFeed.id}
                feed={shownFeed}
                preview={shownFeed === resolvedFeed ? urlPreview || undefined : undefined}
                onBack={() => { setPreviewFeed(null); setUrlFeedOpen(false); }}
                subscribeButton={subscribeButton(shownFeed)}
                isDark={isDark}
              />
            ) : previewUrl ? (
              <div aria-live="polite" aria-busy={previewLoading} className="space-y-5">
                {previewLoading ? (
                  <p role="status" className="py-6 flex items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="w-5 h-5 animate-spin" />{xProfile(previewUrl) ? 'X 공개 게시물을 불러오는 중입니다…' : '이 주소에서 RSS 피드를 찾는 중입니다…'}</p>
                ) : resolvedFeed ? (
                  <section aria-label="찾은 피드" className="space-y-2">
                    <h3 className="text-xs font-semibold text-slate-400">찾은 피드</h3>
                    {feedCard(resolvedFeed, () => setUrlFeedOpen(true))}
                  </section>
                ) : previewError ? (
                  <div className="py-4 text-center">
                    <p role="alert" className="text-sm text-rose-500">{previewError}</p>
                    <button type="button" onClick={() => setPreviewRetry((value) => value + 1)} className="mt-3 px-3 py-2 rounded-xl text-xs text-emerald-500 border border-emerald-500/40 cursor-pointer">다시 시도</button>
                  </div>
                ) : null}
                {builderSuggestion}
              </div>
            ) : <div className="space-y-5">
              {/* 분류 필터 알약 버튼 */}
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : isDark
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3.5">
                {filteredCurated.length === 0 && <p className="sm:col-span-2 py-10 text-center text-sm text-slate-400">검색 결과가 없습니다. RSS 또는 웹사이트 주소로도 찾아보세요.</p>}
                {filteredCurated.map((feed) => feedCard(feed, () => setPreviewFeed(feed)))}
              </div>
            </div>
          )}

          {tab === 'x' && <XFollowingImporter isDark={isDark} subscriptions={subscriptions} onBusyChange={setXImporting} onSubscribed={onSubscribed} />}

          {/* OPML 가져오기 / 내보내기 */}
          <div className={tab === 'opml' ? 'space-y-6' : 'hidden'}>
              {/* 내보내기 카드 */}
              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isDark
                    ? 'bg-slate-950/60 border-slate-800'
                    : 'bg-slate-50 border-slate-200'
                }`}
              >
                <div>
                  <h3 className="text-sm font-bold mb-1">
                    내 구독 목록 OPML 내보내기 (Export)
                  </h3>
                  <p className="text-xs text-slate-400">
                    현재 구독 중인 모든 폴더와 RSS 피드 목록을 표준 OPML 2.0 XML 파일로
                    다운로드합니다.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={opmlImporting}
                  onClick={handleExportOpml}
                  className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>OPML 다운로드 (.opml)</span>
                </button>
              </div>

              <OpmlImporter
                isDark={isDark}
                onBusyChange={setOpmlImporting}
                onSubscribed={onSubscribed}
              />
          </div>
        </div>
      </div>
    </div>
  );
};
