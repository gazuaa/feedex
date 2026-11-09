import type { ArticleItem, FolderItem, SubscriptionItem } from './api';
import { isXProfileFeed } from '../shared/xFeed';

// 안의 피드가 모두 X 계정인 폴더. 사이드바와 보관함에서 일반 폴더와 떼어 보여 준다.
export function xFolderIds(folders: FolderItem[], subscriptions: SubscriptionItem[]): Set<string> {
  return new Set(folders.filter((folder) => {
    const feeds = subscriptions.filter((feed) => feed.folder_id === folder.id);
    return feeds.length > 0 && feeds.every((feed) => isXProfileFeed(feed.xml_url));
  }).map((folder) => folder.id));
}

export interface XMedia { src: string; video: boolean }
export interface XPost {
  /** 글을 쓴 계정. 재게시면 원래 글쓴이다. */
  name: string; handle: string; avatar: string | null;
  /** 이 계정이 다른 사람의 글을 재게시했을 때 재게시한 계정 이름. */
  repostedBy: string | null;
  replyTo: string | null;
  text: string;
  media: XMedia[];
  card: { href: string; image: string | null; title: string } | null;
  quote: { name: string; handle: string; text: string; href: string; media: XMedia[] } | null;
}

const statusUser = (url: string) => /^https:\/\/x\.com\/([a-z\d_]{1,15})\/status\//i.exec(url)?.[1] || null;

// 피드 제목은 "이름 (@아이디)"(X 팔로우 가져오기) 또는 "이름 / @아이디"(공개 미러) 모양이다.
export function xFeedAccount(article: Pick<ArticleItem, 'feed_title' | 'feed_html_url'>): { name: string; handle: string } {
  const titled = /^(.*?)\s*(?:\(\s*@([a-z\d_]{1,15})\s*\)|\/\s*@([a-z\d_]{1,15}))\s*$/i.exec(article.feed_title || '');
  const fromUrl = /^https:\/\/x\.com\/([a-z\d_]{1,15})\/?$/i.exec(article.feed_html_url || '')?.[1];
  const handle = titled?.[2] || titled?.[3] || fromUrl || article.feed_title || 'X';
  return { name: titled?.[1]?.trim() || article.feed_title || handle, handle };
}

// 미러 RSS 본문: 첫 문단이 글이고, 사진·동영상 썸네일이 뒤따른다. <hr/> 뒤에는 링크 카드나 인용 글이 온다.
export function parseXPost(article: ArticleItem, Parser: typeof DOMParser | undefined = globalThis.DOMParser): XPost {
  if (!article) return { name: 'X', handle: 'X', avatar: null, repostedBy: null, replyTo: null, text: '', media: [], card: null, quote: null };
  const owner = xFeedAccount(article);
  const author = statusUser(article.url || '') || owner.handle || 'X';
  const title = article.title || '';
  const reposted = /^RT by @([a-z\d_]{1,15}):\s*/i.exec(title);
  const reply = /^R to @([a-z\d_]{1,15}):\s*/i.exec(title);
  const own = author.toLowerCase() === (owner.handle || '').toLowerCase();
  const post: XPost = {
    name: own ? owner.name : author, handle: author, avatar: own && article.feed_favicon && /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(article.feed_favicon) ? article.feed_favicon : null,
    repostedBy: reposted && !own ? owner.name : null, replyTo: reply?.[1] || null,
    text: title.replace(/^(?:RT by|R to) @[a-z\d_]{1,15}:\s*/i, ''), media: [], card: null, quote: null,
  };
  if (!article.content_html || !Parser) return post;
  // <hr/> 앞은 글과 사진, 뒤는 링크 카드나 인용 글이다. 두 부분을 따로 읽는다.
  const html = article.content_html, cut = html.search(/<hr\b/i);
  const read = (part: string) => new Parser().parseFromString(`<!doctype html><html><head></head><body>${part}</body></html>`, 'text/html').body;
  const main = read(cut < 0 ? html : html.slice(0, cut)), extra = cut < 0 ? null : read(html.slice(cut));
  const textOf = (node: Element | null) => {
    if (!node) return '';
    // 원본 HTML의 줄바꿈 글자는 모양일 뿐이다. 실제 줄바꿈은 <br>만 쓴다.
    const copy = node.cloneNode(true) as Element;
    copy.querySelectorAll('br').forEach((br) => br.replaceWith('\u2028'));
    return (copy.textContent || '').replace(/[ \t]*[\r\n]+[ \t]*/g, '').replace(/[ \t]*\u2028[ \t]*/g, '\n').trim();
  };
  const mediaOf = (node: Element) => [...node.querySelectorAll('img')].flatMap((image): XMedia[] => {
    const src = image.getAttribute('src') || '';
    if (!/^https:\/\/pbs\.twimg\.com\//.test(src)) return [];
    // 동영상은 글 링크 안에 "Video" 글자와 썸네일로 들어온다.
    const holder = image.parentElement;
    return [{ src, video: /video_thumb/.test(src) || (holder?.tagName === 'A' && /\bVideo\b/.test(holder.textContent || '')) }];
  });
  const paragraphs = [...main.querySelectorAll('p')].map(textOf).filter(Boolean);
  post.text = paragraphs.join('\n\n') || post.text;
  post.media = mediaOf(main);
  // 미러는 인용 글을 <p> 안에 <p>로 감싸 보내서, 읽고 나면 빈 문단과 글 문단이 나란히 남는다.
  const quote = extra?.querySelector('blockquote');
  if (quote) {
    const who = /^(.*?)\s*\(@([a-z\d_]{1,15})\)\s*$/i.exec(quote.querySelector('b')?.textContent?.trim() || '');
    const href = quote.querySelector('cite a')?.getAttribute('href') || '';
    const quoteStatus = /(?:https?:\/\/[^/]+)?\/([a-z\d_]{1,15})\/status\/(\d{1,20})/i.exec(href);
    const quoteUrl = quoteStatus ? `https://x.com/${quoteStatus[1]}/status/${quoteStatus[2]}` : /^https:\/\//.test(href) ? href : article.url;
    const copy = quote.cloneNode(true) as Element;
    copy.querySelector('b')?.remove();
    copy.querySelector('cite')?.remove();
    copy.querySelector('footer')?.remove();
    copy.querySelectorAll('img').forEach((img) => img.remove());
    copy.querySelectorAll('br').forEach((br) => br.replaceWith('\u2028'));
    const allP = [...quote.querySelectorAll('p')].map(textOf).filter(Boolean).join('\n\n');
    const directText = (copy.textContent || '').replace(/[ \t]*[\r\n]+[ \t]*/g, '\n').replace(/[ \t]*\u2028[ \t]*/g, '\n').trim();
    const quoteText = allP || directText;
    post.quote = { name: who?.[1] || who?.[2] || '', handle: who?.[2] || statusUser(quoteUrl) || '', text: quoteText, href: quoteUrl, media: mediaOf(quote) };
  } else if (extra) {
    const link = extra.querySelector('a[href]');
    const href = link?.getAttribute('href') || '';
    const image = link?.querySelector('img')?.getAttribute('src') || null;
    if (/^https?:\/\//.test(href)) post.card = { href, image: image && /^https:\/\/pbs\.twimg\.com\//.test(image) ? image : null, title: link?.querySelector('b')?.textContent?.trim() || href.replace(/^https?:\/\/(www\.)?/, '') };
  }
  return post;
}

// X처럼 짧게: 1분 전은 "방금", 하루 안은 "3시간", 올해는 "11월 2일", 그 전은 연도까지.
export function xTime(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return '방금';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}시간`;
  const date = new Date(time), today = new Date(now);
  return date.getFullYear() === today.getFullYear() ? `${date.getMonth() + 1}월 ${date.getDate()}일` : `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}
