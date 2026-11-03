import { ArticleBlockTag } from './ArticleBlockTag';
import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  CheckCircle2,
  Circle,
  ExternalLink,
  Sparkles,
  Rss,
  Inbox,
  Plus,
} from 'lucide-react';
import {
  formatArticleDate,
  type ArticleItem,
  type LayoutMode,
} from '../client/api';
import { useArticleThumbnail } from '../client/thumbnails';
import { XTimeline } from './XTimeline';
// 가까운 글의 이미지를 찾는 동안에는 사이트 로고를 보여 준다.
export function FeedLogo({ article }: { article: ArticleItem }) {
  const [failed, setFailed] = useState(0);
  let origin = '';
  try { origin = new URL(article.feed_html_url || article.url).origin; } catch {}
  const candidates = [...new Set([article.feed_favicon, origin ? `${origin}/favicon.ico` : null].filter(Boolean))] as string[];
  const logo = candidates[failed];
  return <div className="sfeed-feed-logo" aria-label={`${article.feed_title} 로고`}>{logo ? <img src={logo} alt="" loading="lazy" onError={() => setFailed((value) => value + 1)} /> : <span>{(article.feed_title || 'RSS').slice(0, 2)}</span>}</div>;
}
function Thumbnail({ article, accountId, onUpdateArticleFields, card = false, isDark = false }: { article: ArticleItem; accountId: string; onUpdateArticleFields?: ArticleListProps['onUpdateArticleFields']; card?: boolean; isDark?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const { ref, url } = useArticleThumbnail<HTMLDivElement>(article, accountId, onUpdateArticleFields);
  return <div ref={ref} className={card ? 'h-full w-full' : `sfeed-magazine-thumbnail h-16 w-16 rounded-lg overflow-hidden shrink-0 border ${isDark ? 'border-slate-800' : 'border-slate-200'}`}>
    {url && url !== broken ? <img src={url} alt={article.title} loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={() => setBroken(url)} /> : <FeedLogo article={article} />}
  </div>;
}
const MagazineThumbnail = Thumbnail;

interface ArticleListProps {
  accountId?: string;
  onUpdateArticleFields?: (id: string, fields: Partial<ArticleItem>) => void;
  onPrepareArticle?: (article: ArticleItem, current: () => boolean) => void;
  articles: ArticleItem[];
  layout: LayoutMode;
  selectedArticleId: string | null;
  onSelectArticle: (article: ArticleItem) => void;
  onOpenXPost?: (article: ArticleItem, url: string) => void;
  onToggleRead: (article: ArticleItem, e: React.MouseEvent) => void;
  onToggleSaved: (article: ArticleItem, e: React.MouseEvent) => void;
  onOpenDiscover: () => void;
  isDark: boolean;
  loading: boolean;
  hasSubscriptions: boolean;
  retainReadRows?: boolean;
  /** X 폴더·X 계정을 볼 때는 보기 설정과 상관없이 X 타임라인 모양으로 그린다. */
  timeline?: boolean;
  blockedArticleIds?: ReadonlySet<string>;
}

export const ArticleList: React.FC<ArticleListProps> = ({
  accountId = '',
  onUpdateArticleFields,
  onPrepareArticle,
  articles,
  layout,
  selectedArticleId,
  onSelectArticle,
  onOpenXPost,
  onToggleRead,
  onToggleSaved,
  onOpenDiscover,
  isDark,
  loading,
  hasSubscriptions,
  retainReadRows = false,
  timeline = false,
  blockedArticleIds,
}) => {
  const listRef = useRef<HTMLDivElement>(null), latestArticles = useRef(articles);
  latestArticles.current = articles;
  const preparationIds = articles.map((article) => article.id).join(':');
  useEffect(() => {
    if (!onPrepareArticle || !listRef.current || typeof IntersectionObserver === 'undefined') return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const id = (entry.target as HTMLElement).dataset.articleId;
        const article = latestArticles.current.find((row) => row.id === id);
        if (article) onPrepareArticle(article, () => {
          const box = entry.target.getBoundingClientRect();
          return active && box.bottom >= 0 && box.top <= window.innerHeight + 150;
        });
      }
    }, { rootMargin: '150px 0px' });
    listRef.current.querySelectorAll('[data-article-id]').forEach((row) => observer.observe(row));
    return () => { active = false; observer.disconnect(); };
  }, [onPrepareArticle, preparationIds, layout, loading, timeline]);
  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-4 max-w-5xl mx-auto">
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            className={`h-28 rounded-2xl animate-pulse border ${
              isDark
                ? 'bg-slate-900/60 border-slate-800/80'
                : 'bg-slate-100 border-slate-200'
            }`}
          />
        ))}
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="py-24 px-6 text-center max-w-md mx-auto">
        <div
          className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
            isDark
              ? 'bg-slate-900 border border-slate-800 text-emerald-400'
              : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          <Inbox className="w-7 h-7" />
        </div>
        <h3
          className={`text-lg font-bold mb-1.5 ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          {hasSubscriptions ? '표시할 아티클이 없습니다' : '관심 있는 피드로 시작하세요'}
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          {hasSubscriptions
            ? '모든 아티클을 다 읽었거나 검색 조건에 맞는 글이 없습니다. 새로운 RSS 피드를 추가하거나 안읽음 필터를 해제해 보세요.'
            : '아직 구독 중인 피드가 없습니다. 추천 목록에서 원하는 피드를 골라 구독해 보세요. 선택한 피드만 내 목록에 추가됩니다.'}
        </p>
        <button
          type="button"
          onClick={onOpenDiscover}
          className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 cursor-pointer transition"
        >
          <Plus className="w-4 h-4" />
          <span>추천 피드 추가하기</span>
        </button>
      </div>
    );
  }

  if (timeline) return <XTimeline blockedArticleIds={blockedArticleIds} onOpenXPost={onOpenXPost} articles={articles} selectedArticleId={selectedArticleId} onSelectArticle={onSelectArticle} onToggleRead={onToggleRead} onToggleSaved={onToggleSaved} isDark={isDark} retainReadRows={retainReadRows} listRef={listRef} />;

  // 1. 간단한 목록 보기 (Feedly 제목만 보기)
  if (layout === 'list') {
    return (
      <div ref={listRef} className="sfeed-list-items p-4 lg:p-8 max-w-6xl mx-auto" data-retain-read={retainReadRows || undefined}>
        <div
          className={`rounded-2xl border overflow-hidden divide-y ${
            isDark
              ? 'bg-slate-900/50 border-slate-800/80 divide-slate-800/70'
              : 'bg-white border-slate-200 divide-slate-100 shadow-xs'
          }`}
        >
          {articles.map((article) => {
            const isSelected = selectedArticleId === article.id;
            return (
              <div
                key={article.id}
                data-article-id={article.id}
                data-article-read={article.is_read}
                onClick={() => onSelectArticle(article)}
                className={`sfeed-compact-row group flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition cursor-pointer ${
                  isSelected
                    ? isDark
                      ? 'bg-emerald-500/10'
                      : 'bg-emerald-50/80'
                    : isDark
                    ? 'hover:bg-slate-800/60'
                    : 'hover:bg-slate-50'
                }`}
              >
                <div className="sfeed-compact-content flex items-center gap-3 min-w-0 flex-1">
                  {/* 안 읽음 / 읽음 상태 전환 */}
                  <button
                    type="button"
                    onClick={(e) => onToggleRead(article, e)}
                    title={article.is_read ? '안읽음으로 표시' : '읽음으로 표시'}
                    className="shrink-0 text-slate-400 hover:text-emerald-400 cursor-pointer"
                  >
                    {article.is_read ? (
                      <CheckCircle2 className="w-4 h-4 text-slate-600" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block mx-0.5" />
                    )}
                  </button>

                  {/* 피드 출처 */}
                  <div className="sfeed-compact-source flex items-center gap-1.5 w-32 sm:w-40 shrink-0 truncate">
                    {article.feed_favicon ? (
                      <img
                        src={article.feed_favicon}
                        alt=""
                        className="w-3.5 h-3.5 rounded-sm shrink-0"
                      />
                    ) : (
                      <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    )}
                    <span className="text-xs font-medium text-slate-400 truncate">
                      {article.feed_title}
                    </span>
                  </div>

                  {/* 제목과 한 줄 요약 */}
                  <div className="sfeed-compact-title min-w-0 flex-1 truncate">
                    <span
                      className={`${
                        article.is_read
                          ? isDark
                            ? 'text-slate-400 font-normal'
                            : 'text-slate-500 font-normal'
                          : isDark
                          ? 'text-slate-100 font-semibold'
                          : 'text-slate-900 font-semibold'
                      }`}
                    >
                      {article.title}
                    </span>
                    {article.ai_summary && (
                      <span className="ml-2 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400">
                        <Sparkles className="w-2.5 h-2.5" /> AI 요약됨
                      </span>
                    )}
                    {article.summary && (
                      <span className="ml-2 text-xs text-slate-500">
                        — {article.summary}
                      </span>
                    )}
                  </div>
                </div>

                {/* 오른쪽 시각과 빠른 동작 */}
                <div className="flex items-center gap-2 shrink-0">
                  <ArticleBlockTag blocked={Boolean(blockedArticleIds?.has(article.id))} />
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">
                    {formatArticleDate(article)}
                  </span>

                  <button
                    type="button"
                    onClick={(e) => onToggleSaved(article, e)}
                    title="나중에 읽기(북마크)"
                    className={`p-1 rounded transition cursor-pointer ${
                      article.is_saved
                        ? 'text-indigo-400'
                        : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-indigo-400'
                    }`}
                  >
                    <Bookmark
                      className={`w-3.5 h-3.5 ${
                        article.is_saved ? 'fill-current' : ''
                      }`}
                    />
                  </button>

                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="원문 새 창 열기"
                    className="p-1 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:text-emerald-400 transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 2. 카드 보기 (격자 배치)
  if (layout === 'cards') {
    return (
      <div ref={listRef} className="sfeed-list-items sfeed-article-cards p-4 lg:p-8 max-w-7xl mx-auto grid grid-cols-1 gap-5" data-retain-read={retainReadRows || undefined}>
        {articles.map((article) => {
          const isSelected = selectedArticleId === article.id;
          return (
            <article
              key={article.id}
              data-article-id={article.id}
              data-article-read={article.is_read}
              onClick={() => onSelectArticle(article)}
              className={`group rounded-2xl border overflow-hidden flex flex-col justify-between transition duration-200 cursor-pointer ${
                isSelected
                  ? 'ring-2 ring-emerald-500 border-emerald-500/50'
                  : isDark
                  ? 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
                  : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div>
                {/* 표지 이미지 또는 그라데이션 띠 */}
                <div className="h-44 w-full overflow-hidden relative bg-gradient-to-br from-slate-800 via-slate-900 to-emerald-950">
                  <Thumbnail article={article} accountId={accountId} onUpdateArticleFields={onUpdateArticleFields} card />

                  {!article.is_read && (
                    <span className="absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950 shadow">
                      NEW
                    </span>
                  )}

                  {article.ai_summary && (
                    <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-950/85 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 backdrop-blur-xs">
                      <Sparkles className="w-3 h-3" /> AI 요약
                    </span>
                  )}
                </div>

                {/* 카드 본문 */}
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <ArticleBlockTag blocked={Boolean(blockedArticleIds?.has(article.id))} />
                      {article.feed_favicon ? (
                        <img
                          src={article.feed_favicon}
                          alt=""
                          className="w-3.5 h-3.5 rounded-sm shrink-0"
                        />
                      ) : (
                        <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      )}
                      <span className="font-medium truncate">{article.feed_title}</span>
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500">
                      {formatArticleDate(article)}
                    </span>
                  </div>

                  <h2
                    className={`text-base leading-snug mb-2 line-clamp-2 ${
                      article.is_read
                        ? isDark
                          ? 'text-slate-400 font-medium'
                          : 'text-slate-500 font-medium'
                        : isDark
                        ? 'text-slate-100 font-bold group-hover:text-emerald-300'
                        : 'text-slate-900 font-bold group-hover:text-emerald-600'
                    }`}
                  >
                    {article.title}
                  </h2>

                  {article.summary && (
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                      {article.summary}
                    </p>
                  )}
                </div>
              </div>

              {/* 카드 바닥글 */}
              <div
                className={`px-4 py-2.5 border-t flex items-center justify-between text-xs ${
                  isDark ? 'border-slate-800/70' : 'border-slate-100'
                }`}
              >
                <span className="text-slate-500 truncate max-w-[160px]">
                  {article.author || article.folder_name || 'RSS 아티클'}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => onToggleRead(article, e)}
                    title={article.is_read ? '안읽음으로 표시' : '읽음으로 표시'}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800/40 transition cursor-pointer"
                  >
                    {article.is_read ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500/70" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => onToggleSaved(article, e)}
                    title="나중에 읽기(북마크)"
                    className={`p-1.5 rounded-lg transition cursor-pointer ${
                      article.is_saved
                        ? 'text-indigo-400 bg-indigo-500/10'
                        : 'text-slate-400 hover:text-indigo-400 hover:bg-slate-800/40'
                    }`}
                  >
                    <Bookmark
                      className={`w-4 h-4 ${article.is_saved ? 'fill-current' : ''}`}
                    />
                  </button>

                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title="원문 보기"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-800/40 transition"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  // 3. 매거진 보기 (Feedly 기본 클래식 배치)
  return (
    <div ref={listRef} className="sfeed-list-items p-3 lg:p-4 max-w-5xl mx-auto space-y-2" data-retain-read={retainReadRows || undefined}>
      {articles.map((article) => {
        const isSelected = selectedArticleId === article.id;
        return (
          <article
            key={article.id}
            data-article-id={article.id}
            data-article-read={article.is_read}
            onClick={() => onSelectArticle(article)}
            role="button"
            tabIndex={0}
            aria-label={article.title}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectArticle(article); } }}
            className={`sfeed-magazine-row group rounded-xl border p-3 flex flex-row items-start gap-3 transition duration-150 cursor-pointer ${
              isSelected
                ? isDark
                  ? 'border-emerald-500/60 bg-emerald-500/5'
                  : 'border-emerald-500/60 bg-emerald-50/60'
                : isDark
                ? 'bg-slate-900/55 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/90'
                : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
          >
            <MagazineThumbnail article={article} accountId={accountId} onUpdateArticleFields={onUpdateArticleFields} isDark={isDark} />

            <div className="sfeed-magazine-copy flex-1 min-w-0">
              {/*
                * 언제나 한 줄: 출처와 글쓴이는 줄을 바꾸지 않고 잘린다.
                * 구분 기호는 뒤 항목에 붙어 있어서 혼자 남지 않는다.
                */}
              <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap text-xs text-slate-400">
                <ArticleBlockTag blocked={Boolean(blockedArticleIds?.has(article.id))} />
                {!article.is_read && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                )}
                {article.feed_favicon ? (
                  <img
                    src={article.feed_favicon}
                    alt=""
                    className="w-3.5 h-3.5 rounded-sm shrink-0"
                  />
                ) : (
                  <Rss className="w-3.5 h-3.5 shrink-0" />
                )}
                <span
                  className={`font-medium truncate min-w-0 max-w-[60%] ${
                    isDark ? 'text-slate-300' : 'text-slate-600'
                  }`}
                >
                  {article.feed_title}
                </span>
                <span className="shrink-0">· {formatArticleDate(article)}</span>
                {article.author && (
                  <span className="sfeed-magazine-author truncate min-w-0">· {article.author}</span>
                )}
              </div>

              <h2
                className={`mt-1.5 text-[15px] leading-snug line-clamp-3 transition ${
                  article.is_read
                    ? isDark
                      ? 'text-slate-400 font-normal'
                      : 'text-slate-500 font-normal'
                    : isDark
                    ? 'text-slate-100 font-semibold group-hover:text-emerald-300'
                    : 'text-slate-900 font-semibold group-hover:text-emerald-600'
                }`}
              >
                {article.title}
              </h2>
            </div>
          </article>
        );
      })}
    </div>
  );
};
