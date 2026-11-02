import React from 'react';
import { ConfirmDialog } from './ConfirmDialog';

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
  return (
    <ConfirmDialog
      title={side ? `선택한 글 ${place}의 글을 읽음 처리할까요?` : '모두 읽음 처리할까요?'}
      confirmLabel={side ? '읽음 처리' : '모두 읽음 처리'}
      isDark={isDark}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
      focusConfirm={focusConfirm}
    >
      {side
        ? <p>{where}에서 {search && <><strong>‘{search}’</strong> 검색 결과 중 </>}선택한 글 {place}에 있는 안읽은 글을 모두 읽음으로 표시합니다. 선택한 글은 그대로 둡니다.</p>
        : search
          ? <p>{where}에서 <strong>‘{search}’</strong> 검색 결과에 나온 안읽은 글만 읽음으로 표시합니다.</p>
          : <p>{where}{savedOnly ? ' 중' : '의'} 안읽은 글을 모두 읽음으로 표시합니다.</p>}
      {focusConfirm && <p className="mt-2 opacity-70">Enter로 확인, Esc로 취소</p>}
    </ConfirmDialog>
  );
};
