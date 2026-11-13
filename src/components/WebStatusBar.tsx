import type { ReactNode } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { leavesForOriginal, opensOriginalSeparately, originalArticleUrl } from '../client/originalWindow';

const ORIGINAL_HELP = '원문 사이트에서 읽고 로그인할 수 있어요.';

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
  const separate = opensOriginalSeparately();
  // 글자가 작아서 밝은 배경에서는 한 단계 진한 색을 쓴다.
  const accent = isDark ? 'text-emerald-400' : 'text-emerald-600';
  // 휴대폰에서는 접혀도 막대를 지우지 않고 사이트 위로 올려 보내, 사이트가 자리를 지키게 한다(index.css).
  return <div data-scroll-hidden={hidden || undefined} inert={hidden || undefined} className={`feedex-web-status @container shrink-0 border-b text-[11px] ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
    <div className="flex min-h-[33px] items-center gap-3 px-4">
      {busy && <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden="true" />}
      <span role="status" className="min-w-0 flex-1 truncate" title={notice}><WebLabel short={shortNotice} long={notice} /></span>
      <div className="flex shrink-0 items-center gap-3 whitespace-nowrap [&>*]:py-2">
        {children}
        {original && (
          <a href={original.href} target={separate ? '_blank' : undefined} rel="noreferrer" title={ORIGINAL_HELP} onClick={(event) => { if (!separate && leavesForOriginal(event)) onLeave?.(); }} className={`inline-flex items-center gap-1 font-semibold hover:underline ${accent}`}>
            <WebLabel short="원문" long="원문에서 읽기·로그인" /><ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  </div>;
}
