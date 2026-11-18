import React, { useState } from 'react';
import type { FolderItem } from '../client/api';
import { ConfirmDialog } from './ConfirmDialog';
import { t } from '../shared/i18n';

const NEW = '__new';

interface MoveFeedDialogProps {
  feedTitle: string;
  folders: FolderItem[];
  currentFolderId: string | null;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  /** 폴더 id(null은 미분류), 또는 먼저 만들 폴더의 이름. */
  onMove: (target: { folderId: string | null } | { newFolder: string }) => void;
}

export const MoveFeedDialog: React.FC<MoveFeedDialogProps> = ({
  feedTitle, folders, currentFolderId, isDark, busy, error, onCancel, onMove,
}) => {
  const [choice, setChoice] = useState(currentFolderId && folders.some((folder) => folder.id === currentFolderId) ? currentFolderId : '');
  const [name, setName] = useState('');
  const field = `mt-3 w-full rounded-xl border px-3 py-2 text-sm ${isDark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`;
  return (
    <ConfirmDialog
      title={t('폴더 옮기기', 'Move to folder')}
      confirmLabel={t('옮기기', 'Move')}
      busyLabel={t('옮기는 중…', 'Moving…')}
      isDark={isDark}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={() => {
        if (choice !== NEW) onMove({ folderId: choice || null });
        else if (name.trim()) onMove({ newFolder: name.trim() });
      }}
    >
      <p>{t('', 'Choose a folder for ')}<strong>{feedTitle}</strong>{t(' 피드를 옮길 폴더를 고르세요.', '.')}</p>
      <select aria-label={t('옮길 폴더', 'Destination folder')} value={choice} onChange={(event) => setChoice(event.target.value)} className={field}>
        <option value="">{t('미분류', 'Unfiled')}</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}{folder.id === currentFolderId ? t(' (현재)', ' (current)') : ''}</option>)}
        <option value={NEW}>{t('새 폴더 만들기…', 'New folder…')}</option>
      </select>
      {choice === NEW && <input autoFocus aria-label={t('새 폴더 이름', 'New folder name')} placeholder={t('새 폴더 이름', 'New folder name')} value={name} maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && name.trim() && !busy) onMove({ newFolder: name.trim() }); }}
        className={field} />}
    </ConfirmDialog>
  );
};
