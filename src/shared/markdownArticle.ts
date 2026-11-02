// 공개 리더 서비스의 본문 형식(마크다운)은 사이트 전체를 담는다: 메뉴, 공유 버튼, 동영상 플레이어 글자,
// 뉴스레터 목록, 쿠키 설정, 추적 픽셀까지. 원래 모양 HTML을 받지 못했을 때 보여 줄 "본문만 보기"를 위해
// 제목(# 한 줄)부터 기사 뒤 목록이 시작되기 전까지만 남기고, 스크립트 없는 읽기용 HTML로 바꾼다.

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (value: string, base: string) => {
  try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
};

// 기사 뒤에 붙는 목록·설정의 제목: 링크만 있는 제목(## [Newsletters](…))이나 흔한 꼬리 영역 이름.
const TAIL = /^#{1,4}\s+(?:\[.*\]\(.*\)\s*$|(?:cookie settings|more for you|related (?:stories|articles|news)|read more|recommended|newsletters?|latest news|trending)\b)/i;
// 공유·선호 출처 버튼, 동영상 플레이어가 남긴 글자처럼 기사 문장이 아닌 줄.
const NOISE = /^(?:share|share this article|copy link.*|summary|show|show more|live|\d{1,2}:\d{2}(?::\d{2})?|auto(?: \d{3,4}p)+|\d+ min read|\[make preferred on\]\(.*\))$/i;
// 동영상 플레이어는 [Video 1](blob:…)로 시작해 단축키 목록, 다음 영상 제목, 재생 속도(0.5x 1x …)를 남긴다.
// 재생 속도 줄이나 긴 기사 문장이 나올 때까지 건너뛴다.
const PLAYER_START = /^\[Video \d+\]\(/i;
const PLAYER_END = /^(?:[\d.]+x\s*){2,}$/;

function inline(text: string, base: string) {
  const parts: string[] = [];
  // 그림과 링크를 먼저 자리표시자로 바꾼 뒤 나머지 글자를 이스케이프한다.
  const marked = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt: string, src: string) => {
      let url = safeUrl(src, base); const label = alt.replace(/^Image \d+:?\s*/i, '');
      // Next.js 이미지 변환 주소(/_next/image?url=…)는 원문 사이트를 거치므로, 안에 든 원본 사진 주소를 쓴다.
      if (url && new URL(url).pathname.endsWith('/_next/image')) url = safeUrl(new URL(url).searchParams.get('url') || '', url) || url;
      // 설명이 없는 그림은 대부분 추적 픽셀이나 장식이라 뺀다.
      if (!url || !label) return '';
      parts.push(`<img src="${escape(url)}" alt="${escape(label)}" loading="lazy">`); return `\u0000${parts.length - 1}\u0000`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, href: string) => {
      const url = safeUrl(href, base);
      parts.push(url ? `<a href="${escape(url)}">${escape(label)}</a>` : escape(label)); return `\u0000${parts.length - 1}\u0000`;
    });
  return escape(marked)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => parts[Number(index)]);
}

/** 기사 부분의 마크다운. 제목 줄이 없으면 처음부터, 꼬리 영역 제목이 나오면 그 앞까지. */
export function articleMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const start = Math.max(0, lines.findIndex((line) => /^#\s+\S/.test(line)));
  const end = lines.findIndex((line, index) => index > start && TAIL.test(line.trim()));
  const kept: string[] = [];
  let player = false;
  for (const raw of lines.slice(start, end === -1 ? undefined : end)) {
    const line = raw.trim();
    if (PLAYER_START.test(line)) { player = true; continue; }
    if (player) { if (PLAYER_END.test(line)) { player = false; continue; } if (line.length < 100) continue; player = false; }
    if (!NOISE.test(line)) kept.push(raw);
  }
  return kept.join('\n');
}

/** 본문만 보기 문서. 스크립트는 없고, 링크는 새 탭에서 열린다. */
export function markdownArticleHtml(markdown: string, url: string, title: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [], list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => { if (paragraph.length) { const text = inline(paragraph.join(' '), url).trim(); if (text) blocks.push(/^<img [^>]*>$/.test(text) ? `<figure>${text}</figure>` : `<p>${text}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(`<${list.ordered ? 'ol' : 'ul'}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${list.ordered ? 'ol' : 'ul'}>`); list = null; } };
  for (const raw of articleMarkdown(markdown).split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line), item = /^(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line) { flushParagraph(); flushList(); }
    else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) { flushParagraph(); flushList(); blocks.push('<hr>'); }
    else if (heading) { flushParagraph(); flushList(); const level = Math.min(heading[1].length, 3); blocks.push(`<h${level}>${inline(heading[2], url)}</h${level}>`); }
    else if (item) { flushParagraph(); const ordered = Boolean(item[2]); if (list && list.ordered !== ordered) flushList(); list ||= { ordered, items: [] }; list.items.push(inline(item[3], url)); }
    else if (line.startsWith('>')) { flushParagraph(); flushList(); blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ''), url)}</blockquote>`); }
    else paragraph.push(line);
  }
  flushParagraph(); flushList();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escape(url)}" target="_blank"><title>${escape(title)}</title>`
    + '<style>body{margin:0;padding:20px 18px 48px;font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2937;background:#fff;overflow-wrap:anywhere}main{max-width:680px;margin:0 auto}h1{font-size:1.6em;line-height:1.25;margin:.2em 0 .6em}h2{font-size:1.2em;line-height:1.35}h3{font-size:1.05em}img{max-width:100%;height:auto;border-radius:8px}figure{margin:1.2em 0}a{color:#047857}blockquote{margin:1em 0;padding-left:1em;border-left:3px solid #d1d5db;color:#4b5563}</style>'
    + `</head><body><main>${blocks.join('\n')}</main></body></html>`;
}
