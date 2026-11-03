import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface LoadMoreArticlesProps {
  loading: boolean;
  auto?: boolean;
  isDark: boolean;
  onLoadMore: () => void;
}

// 목록 끝이 화면에 가까워지면 다음(더 오래된) 페이지를 불러온다.
// 버튼은 직접 누르는 대체 수단으로 남긴다.
export const LoadMoreArticles: React.FC<LoadMoreArticlesProps> = ({
  loading,
  auto = true,
  isDark,
  onLoadMore,
}) => {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loading || !auto) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, onLoadMore, auto]);

  return (
    <div ref={sentinelRef} className="flex justify-center pb-10 pt-2">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className={`px-4 py-2.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:cursor-default ${
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300'
            : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-400 hover:text-emerald-600'
        }`}
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>{loading ? '이전 글 불러오는 중…' : '이전 글 더 보기'}</span>
      </button>
    </div>
  );
};
