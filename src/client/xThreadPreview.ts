import type { ArticleItem } from './api';
import { parseXPost } from './xTimeline';
import { X_THREAD_STYLE } from '../shared/xThreadStyle';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// 글자 속 주소만 링크로 바꾼다. 나머지는 모두 글자로 둔다.
const linked = (text: string) => escape(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);

/**
 * 공개 미러에서 X 글 페이지를 받는 데 몇 초 걸린다. 그동안 피드로 받은 글로 웹 사본과 같은 모양의 문서를
 * 먼저 그리고, 댓글 자리에는 불러오는 중이라고 둔다. 사본이 오면 같은 프레임에서 바뀐다.
 */
export function xThreadPreview(article: ArticleItem, failed = false, Parser?: typeof DOMParser): string {
  const post = parseXPost(article, Parser);
  // 사본이 와도 글자가 바뀌지 않게 미러와 같은 모양(Nov 3, 2026 · 5:34 PM UTC)으로 적는다.
  const date = new Date(article.published_at);
  const when = Number.isFinite(date.getTime()) ? `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC` : '';
  const media = post.media.map((item) => item.video
    ? `<a class="photo video" href="${escape(article.url)}"><img src="${escape(item.src)}" alt=""><span>X에서 동영상 재생</span></a>`
    : `<a class="photo" href="${escape(item.src)}"><img src="${escape(item.src)}" alt=""></a>`).join('');
  const card = post.card ? `<a class="card" href="${escape(post.card.href)}">${post.card.image ? `<img src="${escape(post.card.image)}" alt="">` : ''}<span><strong>${escape(post.card.title)}</strong></span></a>` : '';
  const quote = post.quote ? `<a class="quote" href="${escape(post.quote.href)}"><span class="who"><b>${escape(post.quote.name)}</b> <span>${post.quote.handle ? `@${escape(post.quote.handle)}` : ''}</span></span><span class="text">${escape(post.quote.text)}</span>${post.quote.media.map((item) => `<img src="${escape(item.src)}" alt="">`).join('')}</a>` : '';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escape(article.url)}" target="_blank"><title>${escape(`${post.name} (@${post.handle}) X 글`)}</title><style>${X_THREAD_STYLE}</style></head><body><main>`
    + `<article class="post main">${post.avatar ? `<img class="avatar" src="${escape(post.avatar)}" alt="">` : '<span class="avatar"></span>'}<div class="body">`
    + `<p class="who"><b>${escape(post.name)}</b> <span>@${escape(post.handle)}</span>${when ? ` · <a href="${escape(article.url)}">${escape(when)}</a>` : ''}</p>`
    + (post.replyTo ? `<p class="replying">@${escape(post.replyTo)} 님에게 보내는 답글</p>` : '')
    + `<div class="text">${linked(post.text)}</div>${media ? `<div class="media">${media}</div>` : ''}${card}${quote}</div></article>`
    + `<section class="replies"><h2>댓글</h2>${failed ? '<p class="empty">댓글을 불러오지 못했어요. 위의 다시 시도를 누르거나 X에서 열어 보세요.</p>' : '<p class="empty loading">댓글을 불러오는 중이에요.</p>'}</section>`
    + `<p class="more"><a href="${escape(article.url)}">X에서 열기 (로그인한 상태로 보기·반응)</a></p>`
    + '</main></body></html>';
}
