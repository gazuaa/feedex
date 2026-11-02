import { useEffect, useState } from 'react';
import { RefreshCw, type LucideProps } from 'lucide-react';

/** Tailwind animate-spin 한 바퀴. */
const TURN = 1000;

// 새로고침이 한 바퀴 도중에 끝나면 화살표가 툭 되돌아가고, 빨리 끝나면 깜빡이기만
// 하므로, 아이콘은 한 바퀴를 다 돌 때까지 계속 돈다.
export function RefreshIcon({ spinning, className = '', ...props }: LucideProps & { spinning: boolean }) {
  const [turning, setTurning] = useState(spinning);
  useEffect(() => {
    if (spinning) { setTurning(true); return; }
    // 숨겨진 페이지처럼 멈춘 애니메이션은 한 바퀴 끝에 닿지 못한다.
    const timer = setTimeout(() => setTurning(false), TURN + 100);
    return () => clearTimeout(timer);
  }, [spinning]);
  return <RefreshCw {...props} data-spinning={turning || undefined} className={`${className} ${turning ? 'animate-spin' : ''}`.trim() || undefined} onAnimationIteration={() => { if (!spinning) setTurning(false); }} />;
}
