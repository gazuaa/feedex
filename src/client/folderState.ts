export const collapsedFoldersKey = (account: string) => `sfeed_collapsed_folders:${account}`;
export function readCollapsedFolders(account: string): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(collapsedFoldersKey(account)) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, collapsed]) => collapsed === true).map(([key]): [string, boolean] => [key, true]));
  } catch { return {}; }
}
export function writeCollapsedFolders(account: string, collapsed: Record<string, boolean>) {
  try { localStorage.setItem(collapsedFoldersKey(account), JSON.stringify(Object.fromEntries(Object.entries(collapsed).filter(([, value]) => value === true)))); } catch { /* 이번 세션 동안은 상태를 유지한다 */ }
}
