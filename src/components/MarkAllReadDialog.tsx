import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { t, isEnglish } from '../shared/i18n';

interface MarkAllReadDialogProps {
  scopeName: string;
  search: string;
  savedOnly: boolean;
  /** 열린 글의 위쪽이나 아래쪽 글만. */
  side?: 'above' | 'below';
  focusConfirm?: boolean;
  isDark: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const MarkAllReadDialog: React.FC<MarkAllReadDialogProps> = ({
  scopeName, search, savedOnly, side, focusConfirm, isDark, busy, error, onCancel, onConfirm,
}) => {
  const where = <><strong>{scopeName}</strong>{savedOnly && '의 저장한 글'}</>;
  const place = side === 'above' ? '위' : '아래';
  const scopeEn = <>{savedOnly && 'saved articles in '}<strong>{scopeName}</strong></>;
  const placeEn = side === 'above' ? 'above' : 'below';
  return (
    <ConfirmDialog
      title={side ? t(`선택한 글 ${place}의 글을 읽음 처리할까요?`, `Mark articles ${placeEn} the selected one as read?`) : t('모두 읽음 처리할까요?', 'Mark all as read?')}
      confirmLabel={side ? t('읽음 처리', 'Mark as read') : t('모두 읽음 처리', 'Mark all as read')}
      isDark={isDark}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
      focusConfirm={focusConfirm}
    >
      {isEnglish() ? side
        ? <p>Marks every unread article {placeEn} the selected one in {scopeEn}{search && <> that matches <strong>‘{search}’</strong></>} as read. The selected article stays as it is.</p>
        : search
          ? <p>Marks only the unread articles in {scopeEn} that match <strong>‘{search}’</strong> as read.</p>
          : <p>Marks every unread article in {scopeEn} as read.</p>
      : side
        ? <p>{where}에서 {search && <><strong>‘{search}’</strong> 검색 결과 중 </>}선택한 글 {place}에 있는 안읽은 글을 모두 읽음으로 표시합니다. 선택한 글은 그대로 둡니다.</p>
        : search
          ? <p>{where}에서 <strong>‘{search}’</strong> 검색 결과에 나온 안읽은 글만 읽음으로 표시합니다.</p>
          : <p>{where}{savedOnly ? ' 중' : '의'} 안읽은 글을 모두 읽음으로 표시합니다.</p>}
      {focusConfirm && <p className="mt-2 opacity-70">{t('Enter로 확인, Esc로 취소', 'Enter to confirm, Esc to cancel')}</p>}
    </ConfirmDialog>
  );
};
