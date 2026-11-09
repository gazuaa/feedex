import { ArticleBlockTag } from './ArticleBlockTag';
import React, { useMemo, useState } from 'react';
import { Bookmark, CheckCircle2, Circle, ExternalLink, MessageCircle, Play, Repeat2 } from 'lucide-react';
import { apiRequest, type ArticleItem } from '../client/api';
import { parseXPost, xTime, type XMedia, type XPost } from '../client/xTimeline';
import { useXAvatars } from '../client/xAvatars';

// 만료된 X 카드 이미지(pbs.twimg.com/card_img/...)는 글마다 한 번만 미러에서 새 주소를 받아온다.
const refreshedCards = new Set<string>();
const failedCardImages = new Set<string>();

interface Props {
  articles: ArticleItem[];
  selectedArticleId: string | null;
  onSelectArticle: (article: ArticleItem) => void;
  onToggleRead: (article: ArticleItem, e: React.MouseEvent) => void;
  onToggleSaved: (article: ArticleItem, e: React.MouseEvent) => void;
  onUpdateArticleFields?: (id: string, fields: Partial<ArticleItem>) => void;
  isDark: boolean;
  retainReadRows?: boolean;
  blockedArticleIds?: ReadonlySet<string>;
  listRef: React.RefObject<HTMLDivElement | null>;
}

// X 폴더와 X 계정은 X 타임라인처럼 보여 준다. 글을 누르면 다른 목록처럼 리더에서 열린다.
export function XTimeline({ articles, selectedArticleId, onSelectArticle, onToggleRead, onToggleSaved, onUpdateArticleFields, isDark, retainReadRows, blockedArticleIds, listRef }: Props) {
  // 인용한 글과 재게시한 글은 글쓴이가 구독 계정이 아닐 수 있어 프로필 사진을 따로 찾는다.
  const posts = useMemo(() => new Map(articles.map((article) => [article.id, parseXPost(article)])), [articles]);
  const tabStop = articles.some((article) => article.id === selectedArticleId) ? selectedArticleId : articles[0]?.id;
  const avatarOf = useXAvatars([...posts.values()].flatMap((post) => [post.quote?.handle || '', post.avatar ? '' : post.handle]));
  return <div ref={listRef} data-render-deferred={articles.length >= 120 || undefined} className={`feedex-list-items feedex-x-timeline mx-auto w-full max-w-[600px] min-h-full sm:border-x ${isDark ? 'border-slate-800' : 'border-slate-200 bg-white'}`} data-retain-read={retainReadRows || undefined}>
    {articles.map((article) => <XPostRow tabIndex={tabStop === article.id ? 0 : -1} blocked={Boolean(blockedArticleIds?.has(article.id))} key={article.id} article={article} post={posts.get(article.id) || parseXPost(article)} avatarOf={avatarOf} selected={selectedArticleId === article.id} onSelectArticle={onSelectArticle} onToggleRead={onToggleRead} onToggleSaved={onToggleSaved} onUpdateArticleFields={onUpdateArticleFields} isDark={isDark} />)}
  </div>;
}

// timeline은 X 폴더의 줄이다. 여러 피드가 섞인 목록에서는 그 목록의 모양에 맞춘다.
// row는 매거진 목록의 구분선 줄, card는 카드 격자의 상자, plain은 제목 목록의 줄이다(구분선은 목록이 그린다).
export type XRowVariant = 'timeline' | 'row' | 'card' | 'plain';
export function XPostRow({ article, post, avatarOf, selected, blocked, onSelectArticle, onToggleRead, onToggleSaved, onUpdateArticleFields, isDark, tabIndex = 0, variant = 'timeline' }: { article: ArticleItem; post: XPost; avatarOf: (handle: string) => string | undefined; selected: boolean; blocked: boolean; tabIndex?: number; variant?: XRowVariant } & Pick<Props, 'onSelectArticle' | 'onToggleRead' | 'onToggleSaved' | 'onUpdateArticleFields' | 'isDark'>) {
  const [brokenCard, setBrokenCard] = useState<string | null>(null);
  const refreshExpiredImage = (src: string) => {
    if (!onUpdateArticleFields || !src.includes('pbs.twimg.com/card_img/') || refreshedCards.has(article.id)) return;
    refreshedCards.add(article.id);
    void apiRequest<{ thumbnailUrl: string | null; contentHtml?: string }>(`/api/articles/${article.id}/thumbnail`, {
      method: 'POST',
      body: JSON.stringify({ refresh: true }),
    }).then((res) => {
      if (res.contentHtml) {
        onUpdateArticleFields(article.id, {
          content_html: res.contentHtml,
          ...(res.thumbnailUrl ? { thumbnail_url: res.thumbnailUrl } : {}),
        });
      }
    }).catch(() => {
      refreshedCards.delete(article.id);
    });
  };
  const line = isDark ? 'border-slate-800' : 'border-slate-200';
  // 줄 모양은 바탕을 깔지 않는다. 목록 칸의 바탕을 그대로 쓰고 다른 글 줄과 같은 색으로 반응한다.
  const frame = variant === 'timeline' || variant === 'row' ? `border-b ${line}` : variant === 'plain' ? '' : `rounded-2xl border ${line} ${isDark ? 'bg-slate-900/55' : 'bg-white'}`;
  const hover = variant === 'row' ? isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-slate-50' : isDark ? 'hover:bg-white/[0.03]' : 'hover:bg-black/[0.02]';
  const strong = article.is_read
    ? isDark ? 'text-slate-400' : 'text-slate-500'
    : isDark ? 'text-slate-100' : 'text-slate-900';
  const stop = (event: React.MouseEvent) => event.stopPropagation();
  const action = 'p-2 rounded-full transition cursor-pointer inline-flex items-center gap-1';
  return <article
    data-article-id={article.id}
    data-article-read={article.is_read}
    data-article-selected={selected}
    aria-current={selected ? 'true' : undefined}
    role="button"
    tabIndex={tabIndex}
    aria-label={`${post?.name || 'X'}: ${(post?.text || '').slice(0, 80)}`}
    onClick={() => onSelectArticle(article)}
    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectArticle(article); } }}
    data-x-variant={variant}
    className={`feedex-x-post flex gap-3 px-4 pt-3 pb-1 cursor-pointer transition ${frame} ${hover}`}
  >
    <div className="flex w-10 shrink-0 flex-col items-end gap-1">
      {post.repostedBy && <Repeat2 aria-hidden="true" className="h-4 w-4 text-slate-500" />}
      <Avatar post={post.avatar ? post : { ...post, avatar: avatarOf(post.handle) || null }} isDark={isDark} />
    </div>
    <div className="min-w-0 flex-1">
      {post.repostedBy && <p className="-mt-0.5 mb-0.5 text-[13px] font-semibold text-slate-500">{post.repostedBy} 님이 재게시함</p>}
      <div className="flex min-w-0 items-center gap-1 text-[15px] leading-5">
        <ArticleBlockTag blocked={blocked} />
        <span className={`truncate font-bold ${strong}`}>{post.name}</span>
        <span className="truncate text-slate-500">@{post.handle}</span>
        <span className="shrink-0 text-slate-500">· {xTime(article.published_at)}</span>
        {!article.is_read && <span role="img" aria-label="안 읽음" className="ml-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
      </div>
      {post.replyTo && <p className="text-[15px] leading-5 text-slate-500"><span className="text-sky-500">@{post.replyTo}</span> 님에게 보내는 답글</p>}
      {post.text && <p className={`feedex-x-text mt-0.5 whitespace-pre-wrap break-words leading-snug line-clamp-[14] ${strong}`}>{post.text}</p>}
      <MediaGrid media={post?.media || []} line={line} onImageError={refreshExpiredImage} />
      {post.card && <a href={post.card.href} target="_blank" rel="noopener noreferrer" onClick={stop} className={`mt-3 block overflow-hidden rounded-2xl border ${line}`}>
        {post.card.image && brokenCard !== post.card.image && !failedCardImages.has(post.card.image) && <img src={post.card.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { failedCardImages.add(post.card!.image!); setBrokenCard(post.card!.image); (e.currentTarget as HTMLElement).style.display = 'none'; refreshExpiredImage(post.card!.image!); }} className="aspect-[1.91/1] w-full object-cover" />}
        <span className="block px-3 py-2"><span className="block truncate text-[13px] text-slate-500">{hostOf(post.card.href)}</span><span className={`block truncate text-[15px] ${strong}`}>{post.card.title}</span></span>
      </a>}
      {/* 목록에서 인용 글을 누르면 먼저 이 글을 연다. 인용한 글은 열린 글 안에서 누르면 보인다. */}
      {post.quote && <div className={`mt-3 block rounded-2xl border px-3 py-2.5 ${line}`}>
        <span className="flex min-w-0 items-center gap-1 text-[15px]"><Avatar post={{ name: post.quote.name, handle: post.quote.handle, avatar: avatarOf(post.quote.handle) || null }} isDark={isDark} size="mini" /><span className={`truncate font-bold ${strong}`}>{post.quote.name}</span>{post.quote.handle && <span className="truncate text-slate-500">@{post.quote.handle}</span>}</span>
        {/* block을 함께 주면 줄 수 제한(line-clamp)의 표시 방식을 덮어 긴 인용 글이 다 펼쳐진다. */}
        {post.quote.text && <span className={`mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-5 line-clamp-6 ${strong}`}>{post.quote.text}</span>}
        <MediaGrid media={post.quote.media || []} line={line} compact onImageError={refreshExpiredImage} />
      </div>}
      <div className="-ml-2 mt-1 flex max-w-[425px] items-center justify-between text-slate-500">
        <button type="button" title="댓글 보기" aria-label="댓글 보기" onClick={(event) => { stop(event); onSelectArticle(article); }} className={`${action} hover:bg-sky-500/10 hover:text-sky-500`}><MessageCircle className="h-[18px] w-[18px]" /></button>
        <button type="button" title={article.is_read ? '안읽음으로 표시' : '읽음으로 표시'} aria-label={article.is_read ? '안읽음으로 표시' : '읽음으로 표시'} onClick={(event) => onToggleRead(article, event)} className={`${action} hover:bg-emerald-500/10 hover:text-emerald-500`}>{article.is_read ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500/80" /> : <Circle className="h-[18px] w-[18px]" />}</button>
        <button type="button" title="나중에 읽기(북마크)" aria-label="나중에 읽기(북마크)" aria-pressed={article.is_saved} onClick={(event) => onToggleSaved(article, event)} className={`${action} hover:bg-sky-500/10 hover:text-sky-500 ${article.is_saved ? 'text-sky-500' : ''}`}><Bookmark className={`h-[18px] w-[18px] ${article.is_saved ? 'fill-current' : ''}`} /></button>
        <a href={article.url} target="_blank" rel="noopener noreferrer" title="X에서 열기" aria-label="X에서 열기" onClick={stop} className={`${action} hover:bg-sky-500/10 hover:text-sky-500`}><ExternalLink className="h-[18px] w-[18px]" /></a>
      </div>
    </div>
  </article>;
}

// mini는 인용 글 이름 옆의 작은 사진이다.
function Avatar({ post, isDark, size = 'full' }: { post: Pick<XPost, 'name' | 'handle' | 'avatar'>; isDark: boolean; size?: 'full' | 'mini' }) {
  const [broken, setBroken] = useState<string | null>(null);
  const box = size === 'mini' ? 'h-5 w-5 shrink-0 text-[11px]' : 'h-10 w-10 text-base';
  if (post.avatar && broken !== post.avatar) return <img src={post.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(post.avatar)} className={`${box} rounded-full object-cover`} />;
  const label = (post.name || post.handle || 'X').trim() || 'X';
  return <span aria-hidden="true" className={`flex ${box} items-center justify-center rounded-full font-bold ${isDark ? 'bg-slate-700 text-slate-100' : 'bg-slate-200 text-slate-700'}`}>{label.slice(0, 1).toUpperCase()}</span>;
}

// X처럼 사진 1장은 크게, 2~4장은 격자로 놓는다. 동영상은 썸네일에 재생 표시만 단다.
// compact는 인용 글 안이다. 테두리 없이 낮게 놓는다.
function MediaGrid({ media = [], line, compact = false, onImageError }: { media?: XMedia[]; line: string; compact?: boolean; onImageError?: (src: string) => void }) {
  const [broken, setBroken] = useState<string[]>([]);
  const items = (media || []).filter((item) => item?.src && !broken.includes(item.src)).slice(0, 4);
  if (!items.length) return null;
  const many = items.length > 1;
  return <div className={`overflow-hidden ${compact ? 'mt-2 rounded-xl' : `mt-3 rounded-2xl border ${line}`} ${many ? `grid aspect-[16/9] grid-cols-2 gap-0.5 ${items.length > 2 ? 'grid-rows-2' : ''}` : ''}`}>
    {items.map((item, index) => <div key={item.src} className={`relative min-h-0 ${items.length === 3 && index === 0 ? 'row-span-2' : ''}`}>
      <img src={item.src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => { setBroken((prev) => [...prev, item.src]); onImageError?.(item.src); }} className={many ? 'h-full w-full object-cover' : `${compact ? 'max-h-[320px]' : 'max-h-[510px]'} w-full object-cover`} />
      {item.video && <span className="absolute inset-0 flex items-center justify-center"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/90 text-white"><Play className="ml-0.5 h-6 w-6 fill-current" /></span></span>}
    </div>)}
  </div>;
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// X 표시. 사이드바·보관함의 X 구역과 X 폴더에 쓴다.
export function XLogo({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>;
}
