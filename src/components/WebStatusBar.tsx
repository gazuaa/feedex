import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { openOriginalArticle, originalArticleUrl, watchOriginalReturn } from '../client/originalWindow';

const LOGIN_HELP = '로그인이 필요한 글은 원문 창에서 로그인하고 읽을 수 있어요.';
const AFTER_LOGIN_HELP = '로그인 후에도 다시 묻는다면 원문 창에서 계속 읽어 주세요.';

/** 막대 폭에 맞는 이름을 보여 준다. 데스크톱에서도 글 칸이 좁을 수 있어 기기가 아니라 막대 폭으로 고른다. */
export function WebLabel({ short, long }: { short: string; long: string }) {
  return <><span className="@3xl:hidden">{short}</span><span className="hidden @3xl:inline">{long}</span></>;
}

/**
 * 웹 보기 상단의 한 줄. 지금 보는 것이 무엇인지 왼쪽에 적고, 할 수 있는 일을 오른쪽에 둔다.
 * 본문을 가리지 않도록 줄을 늘리지 않고, 다 보이지 않는 설명은 title로 남긴다.
 */
export function WebStatusBar({ url, isDark, hidden, canLogin, busy = false, notice, shortNotice, onReload, children }: {
  url: string;
  isDark: boolean;
  hidden: boolean;
  canLogin: boolean;
  busy?: boolean;
  notice: string;
  shortNotice: string;
  onReload: () => void;
  children?: ReactNode;
}) {
  const [opened, setOpened] = useState(false), [waiting, setWaiting] = useState(false);
  const reload = useRef(onReload); reload.current = onReload;
  useEffect(() => { if (!waiting) return; return watchOriginalReturn(window, document, () => { setWaiting(false); reload.current(); }); }, [waiting]);
  const original = originalArticleUrl(url);
  const onMac = typeof navigator !== 'undefined' && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;
  const readerLink = onMac && original?.protocol === 'https:'
    ? `feedex-reader://open?url=${encodeURIComponent(original.href)}`
    : null;
  // 글자가 작아서 밝은 배경에서는 한 단계 진한 색을 쓴다.
  const accent = isDark ? 'text-emerald-400' : 'text-emerald-600';
  return <div className={`feedex-web-status @container shrink-0 border-b text-[11px] ${hidden ? 'hidden' : ''} ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
    <div className="flex min-h-[33px] items-center gap-3 px-4">
      {busy && !opened && <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden="true" />}
      <span role="status" className="min-w-0 flex-1 truncate" title={opened ? AFTER_LOGIN_HELP : notice}>
        {opened ? <WebLabel short="로그인 후 다시 불러오세요" long={AFTER_LOGIN_HELP} /> : <WebLabel short={shortNotice} long={notice} />}
      </span>
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap [&>*]:py-2">
        {opened
          ? <button type="button" onClick={() => { setWaiting(false); onReload(); }} className="inline-flex items-center gap-1 hover:underline"><RefreshCw className="w-3 h-3" aria-hidden="true" /><WebLabel short="다시 불러오기" long="로그인 후 다시 표시" /></button>
          : children}
        {readerLink && (
          <a href={readerLink} title="FeedEx 맥 읽기 앱을 먼저 한 번 실행해 주세요." className={`inline-flex items-center gap-1 font-semibold hover:underline ${accent}`}>
            <BookOpen className="w-3 h-3" aria-hidden="true" /><WebLabel short="맥 읽기" long="FeedEx 맥 읽기 창" />
          </a>
        )}
        {canLogin && (
          <a href={url} target="_blank" rel="noopener noreferrer" title={LOGIN_HELP} onClick={event => {
            if (openOriginalArticle(url)) event.preventDefault();
            setOpened(true);
            setWaiting(true);
          }} className={`inline-flex items-center gap-1 font-semibold hover:underline ${accent}`}>
            {opened ? <WebLabel short="원문 창" long="원문 창에서 읽기" /> : <WebLabel short="로그인" long="로그인해서 읽기" />}<ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  </div>;
}
