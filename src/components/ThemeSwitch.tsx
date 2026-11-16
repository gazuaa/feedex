import { Sun, Moon, SunMoon } from 'lucide-react';
import type { ThemePreference } from '../client/api';
import { useResolvedTheme } from '../client/theme';

/** 화면 모드 고르기: 낮, 밤, 시스템 설정 따르기. */
export const THEME_OPTIONS = [
  { value: 'light', label: '낮 모드', Icon: Sun },
  { value: 'dark', label: '밤 모드', Icon: Moon },
  { value: 'system', label: '시스템 설정 따르기', Icon: SunMoon },
] as const;

export function ThemeSwitch({ theme, onChange }: { theme: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  const dark = useResolvedTheme(theme) === 'dark';
  return <div role="group" aria-label="화면 모드" className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5 ${dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
    {THEME_OPTIONS.map(({ value, label, Icon }) => {
      const active = theme === value;
      return <button key={value} type="button" aria-label={label} title={label} aria-pressed={active} onClick={() => { if (!active) onChange(value); }} className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition cursor-pointer ${active ? dark ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm' : dark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-950'}`}><Icon size={14} aria-hidden="true" /></button>;
    })}
  </div>;
}
