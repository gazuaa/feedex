// 글 화면 공유 메뉴의 순서와 숨긴 항목. 기기마다 다르게 쓸 수 있어 이 기기에만 둔다.
const KEY = 'feedex_share_menu';
/** 새로 더한 후보 중 처음에는 숨겨 두는 것(지금까지 보던 메뉴를 그대로 두려고). */
export const SHARE_HIDDEN_BY_DEFAULT = ['chatgpt', 'claude', 'gemini'];

export interface ShareMenuSetting { order: string[]; hidden: string[] }

export function readShareMenu(storage: Pick<Storage, 'getItem'> | null = globalThis.localStorage ?? null): ShareMenuSetting {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    const list = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 40) : null;
    const order = list(saved?.order), hidden = list(saved?.hidden);
    if (order && hidden) return { order, hidden };
  } catch { /* 기본값을 쓴다. */ }
  return { order: [], hidden: SHARE_HIDDEN_BY_DEFAULT };
}
export function saveShareMenu(setting: ShareMenuSetting, storage: Pick<Storage, 'setItem'> | null = globalThis.localStorage ?? null) {
  try { storage?.setItem(KEY, JSON.stringify(setting)); } catch { /* 이번 화면에서만 쓴다. */ }
}
/** 저장한 순서대로 놓고, 저장한 적 없는 항목은 원래 자리 순서로 뒤에 붙인다. */
export function orderShareItems<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = (id: string) => { const at = order.indexOf(id); return at < 0 ? order.length + items.findIndex((item) => item.id === id) : at; };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}
