export interface BuilderArticle {
  title: string;
  url: string;
  summary: string | null;
  thumbnailUrl: string | null;
  publishedAt: string;
  dateSource: 'feed' | 'collected';
}
export interface BuilderGroup {
  selector: string;
  label: string;
  articles: BuilderArticle[];
}
export interface BuilderAnalysis {
  sourceUrl: string;
  title: string;
  groups: BuilderGroup[];
  rendered: boolean;
  /** 페이지 자체를 읽지 못해서 사이트의 사이트맵으로 만들었다. */
  fromSitemap?: boolean;
  /** 클릭으로 고르기용 페이지의 정적 사본 (첫 보기에만). */
  snapshot?: string;
  /** 고른 목록의 다음 쪽 주소들. 목록 아래 쪽 번호 링크에서 찾았다. */
  nextPages?: string[];
}
export interface BuilderSite {
  url: string;
  title: string;
  description: string | null;
}
