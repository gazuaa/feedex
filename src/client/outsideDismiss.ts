import { useEffect, type RefObject } from 'react';

/**
 * 열린 <details> 팝오버를 바깥을 누르거나 창 크기가 바뀌면 닫는다. 바깥 누르기는
 * 닫기만 한다. 그 누르기가 만들 클릭은 삼켜서 팝오버 뒤에 있던 것이 함께 눌리지 않게
 * 한다. 누르기가 스크롤로 바뀌면 아무것도 삼키지 않는다.
 */
export function useOutsideDismiss(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    let swallowing: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearTimeout(swallowing); swallowing = undefined; };
    const close = () => { if (ref.current) ref.current.open = false; };
    const press = (event: PointerEvent) => {
      const details = ref.current;
      if (!details?.open || details.contains(event.target as Node)) return;
      close();
      stop(); swallowing = setTimeout(stop, 1000);
    };
    const swallow = (event: Event) => {
      if (!swallowing) return;
      event.preventDefault(); event.stopPropagation();
      if (event.type === 'click') stop();
    };
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointercancel', stop, true);
    window.addEventListener('mousedown', swallow, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('resize', close);
    return () => {
      stop();
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('mousedown', swallow, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('resize', close);
    };
  }, [ref]);
}
