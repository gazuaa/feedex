import { Sun, Moon, Monitor, Smartphone } from 'lucide-react';
import { useMobileViewport } from '../client/mobile';
import type { ThemePreference } from '../client/api';
import { useResolvedTheme } from '../client/theme';

/**
 * 화면 모드 고르기: 낮, 밤, 시스템 설정 따르기. 글자 없이 그림만 쓴다. 해·달을 겹친 그림은 뜻이 불분명해,
 * 시스템은 "이 기기 설정을 따른다"는 뜻으로 휴대폰에서는 휴대폰, 데스크톱에서는 모니터 그림을 쓴다.
 */
export function useThemeOptions() {
  const mobile = useMobileViewport();
  return [
    { value: 'light', label: '낮 모드', Icon: Sun },
    { value: 'dark', label: '밤 모드', Icon: Moon },
    { value: 'system', label: '시스템 설정 따르기', Icon: mobile ? Smartphone : Monitor },
  ] as const;
}

export function ThemeSwitch({ theme, onChange }: { theme: ThemePreference; onChange: (theme: ThemePreference) => void }) {
  const dark = useResolvedTheme(theme) === 'dark';
  const options = useThemeOptions();
  return <div role="group" aria-label="화면 모드" className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5 ${dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
    {options.map(({ value, label, Icon }) => {
      const active = theme === value;
      return <button key={value} type="button" aria-label={label} title={label} aria-pressed={active} onClick={() => { if (!active) onChange(value); }} className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 transition cursor-pointer ${active ? dark ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm' : dark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-950'}`}><Icon size={14} aria-hidden="true" /></button>;
    })}
  </div>;
}
