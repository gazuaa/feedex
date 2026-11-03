export function ArticleBlockTag({ blocked }: { blocked: boolean }) {
  return blocked ? <span className="sfeed-block-tag" title="제목 차단 규칙에 해당하는 글">차단됨</span> : null;
}
