import type { ReactNode } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { leavesForOriginal, originalArticleUrl } from '../client/originalWindow';

const ORIGINAL_HELP = '원문 사이트를 이 창에서 열어요. 로그인이 필요한 글은 거기서 로그인해 읽고, 뒤로 가면 FeedEx로 돌아와요.';

/** 막대 폭에 맞는 이름을 보여 준다. 데스크톱에서도 글 칸이 좁을 수 있어 기기가 아니라 막대 폭으로 고른다. */
export function WebLabel({ short, long }: { short: string; long: string }) {
  return <><span className="@3xl:hidden">{short}</span><span className="hidden @3xl:inline">{long}</span></>;
}

/**
 * 웹 보기 상단의 한 줄. 지금 보는 것이 무엇인지 왼쪽에 적고, 할 수 있는 일을 오른쪽에 둔다.
 * 본문을 가리지 않도록 줄을 늘리지 않고, 다 보이지 않는 설명은 title로 남긴다.
 */
export function WebStatusBar({ url, isDark, hidden, canLogin, busy = false, notice, shortNotice, onLeave, children }: {
  url: string;
  isDark: boolean;
  hidden: boolean;
  /** 원문으로 넘어가 로그인하고 읽을 수 있는 글인지. X 글은 공개 미러로 보므로 X에서 연다. */
  canLogin: boolean;
  busy?: boolean;
  notice: string;
  shortNotice: string;
  /** 이 창에서 원문으로 넘어가기 직전. 돌아왔을 때 보던 자리를 되살리도록 남긴다. */
  onLeave?: () => void;
  children?: ReactNode;
}) {
  const original = canLogin ? originalArticleUrl(url) : null;
  // 글자가 작아서 밝은 배경에서는 한 단계 진한 색을 쓴다.
  const accent = isDark ? 'text-emerald-400' : 'text-emerald-600';
  return <div className={`feedex-web-status @container shrink-0 border-b text-[11px] ${hidden ? 'hidden' : ''} ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
    <div className="flex min-h-[33px] items-center gap-3 px-4">
      {busy && <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden="true" />}
      <span role="status" className="min-w-0 flex-1 truncate" title={notice}><WebLabel short={shortNotice} long={notice} /></span>
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap [&>*]:py-2">
        {children}
        {/* 새 창을 띄우지 않고 이 창에서 넘어간다. 크롬 앱 창 안에서 열리고, 뒤로 가면 돌아온다. */}
        {original && (
          <a href={original.href} rel="noreferrer" title={ORIGINAL_HELP} onClick={(event) => { if (leavesForOriginal(event)) onLeave?.(); }} className={`inline-flex items-center gap-1 font-semibold hover:underline ${accent}`}>
            <WebLabel short="원문" long="원문에서 읽기·로그인" /><ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  </div>;
}
