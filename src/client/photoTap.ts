export type PhotoTap = { urls: string[]; index: number };

/**
 * 누른 그림을 사진 보기로 열지 정하고, 열 때는 함께 넘겨 볼 사진 목록과 위치를 준다.
 * 본문 보기와 웹 사본이 같은 규칙을 쓴다. 웹 사본에는 이 함수의 소스를 그대로 넣으므로
 * 바깥 이름을 쓰지 않는다(정규식·도우미는 모두 안에 둔다).
 *
 * - 아이콘·로고처럼 작은 그림은 열지 않는다.
 * - 링크가 없는 그림, 그림 파일로 가는 링크 안의 그림은 연다. 링크가 그림 파일이면 그 큰 그림을 연다.
 * - 다른 글로 가는 링크 안의 그림은 본문 폭에 가까운 큰 사진일 때만 연다. 작은 썸네일은 링크를 따른다.
 */
export function photoTap(target: Element, scope: ParentNode, width: number): PhotoTap | null {
  const file = /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i, twitter = /^https:\/\/pbs\.twimg\.com\/media\//i;
  const linkOf = (img: Element) => img.closest('a[href]') as HTMLAnchorElement | null;
  const linksPhoto = (link: HTMLAnchorElement | null) => Boolean(link && (twitter.test(link.href) || file.test(link.href)));
  const viewable = (img: HTMLImageElement) => {
    const src = img.currentSrc || img.src;
    if (!/^https?:\/\//i.test(src) || img.style.display === 'none' || img.style.visibility === 'hidden') return false;
    const box = img.getBoundingClientRect();
    if (box.width < 80 || box.height < 60) return false;
    const link = linkOf(img);
    return !link || linksPhoto(link) || box.width >= width * 0.6;
  };
  const urlOf = (img: HTMLImageElement) => { const link = linkOf(img); return link && linksPhoto(link) ? link.href : img.currentSrc || img.src; };
  const img = target.closest('img') as HTMLImageElement | null;
  if (!img || !viewable(img)) return null;
  const all = Array.from(scope.querySelectorAll('img')).filter(viewable);
  return { urls: all.map(urlOf), index: Math.max(0, all.indexOf(img)) };
}

/**
 * 웹 사본 안에서 그림을 누르면 앱의 사진 보기로 보낸다. 사이트로 나가는 팝업보다 먼저 받아야 해서 캡처로 듣는다.
 * X 사본은 자기 사진 처리(xFrameTools)를 쓰므로 넣지 않는다.
 */
export const COPY_PHOTO_SCRIPT = `<script nonce="sfeed-scroll">addEventListener('click',e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||!e.target?.closest)return;const p=(${photoTap.toString()})(e.target,document,document.documentElement.clientWidth||innerWidth);if(!p)return;e.preventDefault();e.stopPropagation();parent.postMessage({sfeedXPhotos:p},'*')},true)</script>`;
