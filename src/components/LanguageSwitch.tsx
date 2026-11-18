import { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { useMobileViewport } from '../client/mobile';
import { changeLanguage, languagePreference, type LanguagePreference } from '../client/language';
import { t } from '../shared/i18n';

/** 언어 고르기: 시스템 언어 따르기, 한국어, 영어. 화면 모드 고르기와 같은 모양으로 둔다. */
export function useLanguageOptions() {
  const mobile = useMobileViewport();
  return [
    { value: 'system', label: t('시스템 언어 따르기', 'Use system language'), text: null, Icon: mobile ? Smartphone : Monitor },
    { value: 'ko', label: '한국어', text: '한', Icon: null },
    { value: 'en', label: 'English', text: 'EN', Icon: null },
  ] as const;
}

export function LanguageSwitch({ dark }: { dark: boolean }) {
  const [preference, setPreference] = useState<LanguagePreference>(languagePreference);
  const options = useLanguageOptions();
  return <div role="group" aria-label={t('언어', 'Language')} className={`inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5 ${dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
    {options.map(({ value, label, text, Icon }) => {
      const active = preference === value;
      return <button key={value} type="button" aria-label={label} title={label} aria-pressed={active}
        onClick={() => { if (active) return; setPreference(value); changeLanguage(value); }}
        className={`inline-flex min-w-8 items-center justify-center rounded-lg px-2 py-1 text-xs font-semibold transition cursor-pointer ${active ? dark ? 'bg-slate-700 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm' : dark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-950'}`}>
        {Icon ? <Icon size={14} aria-hidden="true" /> : text}
      </button>;
    })}
  </div>;
}
