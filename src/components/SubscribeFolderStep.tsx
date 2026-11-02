import React, { useState } from 'react';
import { ArrowLeft, Check, Folder, FolderPlus, Inbox, Loader2 } from 'lucide-react';
import type { FolderItem } from '../client/api';

export interface FolderChoice {
  title: string;
  folderId?: string;
  folderName?: string;
}

const NEW_FOLDER = '__new__';

/** "구독하기"와 구독 사이의 한 단계: 폴더를 고르고, 원하면 이름을 바꾼다. */
export function SubscribeFolderStep({
  feedTitle,
  siteUrl,
  folders,
  suggestedFolder,
  isDark,
  busy,
  error,
  confirmLabel = '구독하기',
  onBack,
  onConfirm,
}: {
  feedTitle: string;
  siteUrl: string;
  folders: FolderItem[];
  suggestedFolder?: string;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  confirmLabel?: string;
  onBack: () => void;
  onConfirm: (choice: FolderChoice) => void;
}) {
  const suggested = suggestedFolder ? folders.find((folder) => folder.name === suggestedFolder) : undefined;
  const [choice, setChoice] = useState(suggested ? suggested.id : suggestedFolder ? NEW_FOLDER : '');
  const [newName, setNewName] = useState(suggested ? '' : suggestedFolder || '');
  const [title, setTitle] = useState(feedTitle);
  const ready = Boolean(title.trim()) && (choice !== NEW_FOLDER || Boolean(newName.trim()));
  let hostname = siteUrl;
  try { hostname = new URL(siteUrl).hostname; } catch {}

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    onConfirm({
      title: title.trim(),
      folderId: choice && choice !== NEW_FOLDER ? choice : undefined,
      folderName: choice === NEW_FOLDER ? newName.trim() : undefined,
    });
  };
  const input = `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-900'}`;
  const option = (value: string, label: string, icon: React.ReactNode) => (
    <button
      key={value || 'none'}
      type="button"
      role="radio"
      aria-checked={choice === value}
      disabled={busy}
      onClick={() => setChoice(value)}
      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition cursor-pointer ${
        choice === value ? 'border-emerald-500 bg-emerald-500/10' : isDark ? 'border-slate-800 hover:border-slate-600' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {choice === value && <Check className="w-4 h-4 shrink-0 text-emerald-500" />}
    </button>
  );

  return (
    <form onSubmit={submit} aria-labelledby="folder-step-title" className="mx-auto w-full max-w-2xl space-y-5">
      <button type="button" disabled={busy} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-emerald-500 hover:text-emerald-400 cursor-pointer">
        <ArrowLeft className="w-4 h-4" />이전으로
      </button>
      <div className="flex items-center gap-3">
        <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`} alt="" className="w-10 h-10 rounded-xl shrink-0" />
        <div className="min-w-0">
          <h3 id="folder-step-title" className="text-base font-bold">어느 폴더에 구독할까요?</h3>
          <p className="text-xs text-slate-400 truncate">{feedTitle}</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="구독할 폴더" className="grid gap-2 sm:grid-cols-2">
        {option('', '폴더 없음 (미분류)', <Inbox className="w-4 h-4 shrink-0 text-slate-400" />)}
        {folders.map((folder) => option(folder.id, folder.name, <Folder className="w-4 h-4 shrink-0" style={{ color: folder.color }} />))}
        {option(NEW_FOLDER, '새 폴더 만들기', <FolderPlus className="w-4 h-4 shrink-0 text-emerald-500" />)}
      </div>
      {choice === NEW_FOLDER && (
        <input autoFocus aria-label="새 폴더 이름" value={newName} disabled={busy} onChange={(event) => setNewName(event.target.value)} placeholder="새 폴더 이름 (예: 크립토 리서치)" className={input} />
      )}
      <label className="block text-xs font-semibold">
        피드 이름
        <input value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} className={`${input} mt-2`} />
      </label>
      {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-500">{error}</p>}
      <button type="submit" disabled={!ready || busy} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 cursor-pointer disabled:opacity-50 disabled:cursor-default">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {busy ? '구독하는 중…' : confirmLabel}
      </button>
    </form>
  );
}
