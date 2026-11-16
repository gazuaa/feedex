import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** 설정 이름 왼쪽에 목록별 아이콘을 붙인다. 아이콘 없이 쓰면 이름만 보인다. */
export function SettingLabel({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  if (!Icon) return <span>{children}</span>;
  return <span className="feedex-setting-label"><Icon size={18} aria-hidden="true" /><span>{children}</span></span>;
}
