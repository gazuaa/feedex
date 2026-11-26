import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { t } from '../shared/i18n';

export interface ShareMenuItem { id: string; label: string; icon: ReactNode }

/**
 * 공유 메뉴 편집. 줄마다 켜고 끄는 스위치가 있고, 오른쪽 손잡이를 위아래로 끌어 순서를 바꾼다.
 * 끄는 줄은 손가락을 따라가고, 자리가 바뀐 다른 줄은 새 자리로 미끄러져 간다.
 */
export function ShareMenuEditor({ items, hidden, onChange, onDone }: { items: ShareMenuItem[]; hidden: string[]; onChange: (order: string[], hidden: string[]) => void; onDone: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<{ id: string; grab: number; y: number } | null>(null);
  const tops = useRef(new Map<string, number>());
  const [dragging, setDragging] = useState<string | null>(null);
  const ids = items.map((item) => item.id);
  const idsNow = useRef(ids); idsNow.current = ids;
  const follow = (row: HTMLElement) => {
    const current = drag.current, box = list.current?.getBoundingClientRect();
    if (!current || !box) return;
    row.style.transition = 'box-shadow 150ms ease';
    row.style.transform = `translateY(${current.y - current.grab - box.top - row.offsetTop}px)`;
  };
  useLayoutEffect(() => {
    for (const row of list.current?.querySelectorAll<HTMLElement>('[data-share-id]') ?? []) {
      const id = row.dataset.shareId!, top = row.offsetTop, before = tops.current.get(id);
      tops.current.set(id, top);
      if (drag.current?.id === id) { follow(row); continue; }
      if (before === undefined || before === top) continue;
      row.style.transition = 'none';
      row.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => { row.style.transition = 'transform 180ms cubic-bezier(.2,.8,.2,1)'; row.style.transform = ''; });
    }
  });
  const start = (id: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const row = event.currentTarget.closest<HTMLElement>('[data-share-id]'), box = list.current?.getBoundingClientRect();
    if (!row || !box) return;
    event.preventDefault();
    drag.current = { id, grab: event.clientY - box.top - row.offsetTop, y: event.clientY };
    setDragging(id);
    follow(row);
    const move = (moved: PointerEvent) => {
      const current = drag.current, area = list.current?.getBoundingClientRect();
      if (!current || !area) return;
      current.y = moved.clientY;
      follow(row);
      // 들어갈 자리는 줄 높이로 나눈 고정 칸으로 정해, 다른 줄이 움직여도 자리가 흔들리지 않게 한다.
      const height = row.offsetHeight || 1, center = moved.clientY - current.grab - area.top + height / 2;
      const order = idsNow.current.filter((item) => item !== id);
      order.splice(Math.max(0, Math.min(order.length, Math.floor(center / height))), 0, id);
      if (order.join() !== idsNow.current.join()) { idsNow.current = order; onChange(order, hidden); }
    };
    const finish = () => {
      drag.current = null; setDragging(null);
      row.style.transition = 'transform 180ms cubic-bezier(.2,.8,.2,1)'; row.style.transform = '';
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  };
  return <div className="feedex-share-editor">
    <div className="feedex-share-editor-head"><span>{t('켜고 끄고, 손잡이를 끌어 순서를 바꿔요', 'Toggle items and drag the handle to reorder')}</span><button type="button" onClick={onDone}>{t('완료', 'Done')}</button></div>
    <ul ref={list}>
      {items.map((item) => {
        const shown = !hidden.includes(item.id);
        return <li key={item.id} data-share-id={item.id} data-dragging={dragging === item.id || undefined} data-off={!shown || undefined}>
          {item.icon}<span>{item.label}</span>
          <input type="checkbox" role="switch" aria-label={shown ? t(`${item.label} 숨기기`, `Hide ${item.label}`) : t(`${item.label} 보이기`, `Show ${item.label}`)} checked={shown}
            onChange={() => onChange(ids, shown ? [...hidden, item.id] : hidden.filter((id) => id !== item.id))} />
          <button type="button" className="feedex-share-grip" aria-label={t(`${item.label} 옮기기`, `Move ${item.label}`)} onPointerDown={start(item.id)}><GripVertical size={18} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>
  </div>;
}
