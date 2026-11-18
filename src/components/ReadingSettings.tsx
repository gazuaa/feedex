import { useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, Settings2, LayoutList, LayoutGrid, AlignJustify, List, RefreshCw, ScrollText, Type, ArrowDownUp, Languages, type LucideIcon } from 'lucide-react';
import { SettingLabel } from './SettingLabel';
import { useLanguageOptions } from './LanguageSwitch';
import { changeLanguage, languagePreference, type LanguagePreference } from '../client/language';
import { t } from '../shared/i18n';
import type { LayoutMode } from '../client/api';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';
import { TranslationSetting } from './TranslationSetting';
import { XMirrorStatus } from './XMirrorStatus';
import { ArticleBlockSetting } from './ArticleBlockDialog';
import { FONT_SCALES, useTextSize } from '../client/textSize';
import { AUTO_REFRESH_OPTIONS } from '../shared/preferences';
import { useOutsideDismiss } from '../client/outsideDismiss';
import { inNativeApp, nativeAppName, nativeBridge, useNativeAppScale } from '../client/nativeApp';

export interface ScrollReadSettingsProps {
  markReadOnScroll: boolean;
  onChangeMarkReadOnScroll: (enabled: boolean) => void;
}

export function TextSizeControl({ className = '' }: { className?: string }) {
  const [size, setSize] = useTextSize();
  const index = FONT_SCALES.indexOf(size);
  return <div role="group" aria-label={t('글자 크기', 'Text size')} className={`feedex-text-size-control ${className}`}>
    <button type="button" aria-label={t('글자 작게', 'Smaller text')} disabled={index === 0} onClick={() => setSize(FONT_SCALES[index - 1])}><Minus size={18} /></button>
    <button type="button" aria-label={t('기본 글자 크기로', 'Default text size')} onClick={() => setSize(1)}><span aria-hidden="true">{t('가', 'A')}</span></button>
    <button type="button" aria-label={t('글자 크게', 'Larger text')} disabled={index === FONT_SCALES.length - 1} onClick={() => setSize(FONT_SCALES[index + 1])}><Plus size={18} /></button>
  </div>;
}

/** 설정은 제목 붙은 묶음으로 나뉜다. 구분선은 설정마다가 아니라 묶음 사이에만 긋는다. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="feedex-setting-group" aria-label={title}><p className="feedex-setting-group-title">{title}</p><div className="feedex-setting-items">{children}</div></section>;
}
/** 설정 하나: 왼쪽에 이름, 오른쪽에 조절기. */
export function SettingRow({ label, icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return <div className="feedex-setting-row"><SettingLabel icon={icon}>{label}</SettingLabel>{children}</div>;
}
/** 데스크톱 앱의 전체 화면 크기. 기사 글자 크기와 구별하고 브라우저에서는 표시하지 않는다. */
export function NativeAppScaleSetting() {
  const scale = useNativeAppScale();
  if (!inNativeApp()) return null;
  const change = (action: 'smaller' | 'larger' | 'reset') => nativeBridge()?.postMessage({ type: 'appScale', action });
  return <SettingRow label={t('앱 화면 크기', 'App zoom')}><div className="feedex-text-size-control" role="group" aria-label={t('앱 화면 크기', 'App zoom')}>
    <button type="button" aria-label={t('앱 화면 작게', 'Zoom out')} disabled={scale <= 0.5} onClick={() => change('smaller')}><Minus size={18} /></button>
    <button type="button" aria-label={t('앱 화면 기본 크기로', 'Actual size')} title={t('기본 크기로', 'Actual size')} onClick={() => change('reset')}>{t('기본', 'Reset')}</button>
    <button type="button" aria-label={t('앱 화면 크게', 'Zoom in')} disabled={scale >= 1.5} onClick={() => change('larger')}><Plus size={18} /></button>
  </div></SettingRow>;
}

export function NativeAppUpdateSetting() {
  if (!inNativeApp()) return null;
  // 맥 앱은 Sparkle이, 윈도우 앱은 서명을 확인하는 자체 업데이트가 받아서 설치한다.
  // 설정마다 붙던 설명 줄은 화면을 글자로 채워서, 이름만으로 알 수 있는 설정은 설명을 마우스를 올렸을 때만 보인다.
  return <div className="feedex-auto-refresh-setting" title={t('새 버전이 있으면 받아서 설치해요', 'Downloads and installs a new version if there is one')}><span>{t(`${nativeAppName()} 업데이트`, `${nativeAppName()} updates`)}</span><button type="button" className="feedex-cache-clear" onClick={() => nativeBridge()?.postMessage({ type: 'checkForUpdates' })}>{t('업데이트 확인', 'Check for updates')}</button></div>;
}

/** 화면 언어: 시스템 언어 따르기, 한국어, 영어. 바꾸면 화면을 새로 불러온다. */
export function LanguageSetting() {
  const [preference, setPreference] = useState<LanguagePreference>(languagePreference);
  const options = useLanguageOptions();
  return <SettingRow label={t('언어', 'Language')} icon={Languages}><div className="feedex-segmented" role="group" aria-label={t('언어', 'Language')}>{options.map(({ value, label, text, Icon }) => <button key={value} type="button" aria-label={label} title={label} aria-pressed={preference === value} onClick={() => { if (preference === value) return; setPreference(value); changeLanguage(value); }}>{Icon ? <Icon size={17} /> : text}</button>)}</div></SettingRow>;
}
export function TextSizeSetting() {
  return <SettingRow label={t('글자 크기', 'Text size')} icon={Type}><TextSizeControl /></SettingRow>;
}

export function ScrollReadSetting({ markReadOnScroll, onChangeMarkReadOnScroll }: ScrollReadSettingsProps) {
  return <label className="feedex-scroll-read-setting" title={t('위로 지나간 글을 읽음으로 표시해요', 'Marks articles you scroll past as read')}><SettingLabel icon={ScrollText}>{t('스크롤 시 읽음 처리', 'Mark as read on scroll')}</SettingLabel><input type="checkbox" role="switch" aria-label={t('스크롤 시 읽음 처리', 'Mark as read on scroll')} checked={markReadOnScroll} onChange={(event) => onChangeMarkReadOnScroll(event.target.checked)} /></label>;
}

export interface RefreshSettingsProps {
  autoRefreshMinutes: number;
  onChangeAutoRefreshMinutes: (minutes: number) => void;
}
export interface LayoutSettingsProps { layout: LayoutMode; onChangeLayout: (layout: LayoutMode) => void }
export function LayoutSetting({ layout, onChangeLayout }: LayoutSettingsProps) {
  return <SettingRow label={t('목록 보기', 'List layout')} icon={List}><div className="feedex-segmented" role="group" aria-label={t('목록 보기', 'List layout')}>{([{ id: 'magazine', label: t('매거진 뷰', 'Magazine'), Icon: LayoutList }, { id: 'cards', label: t('카드 뷰', 'Cards'), Icon: LayoutGrid }, { id: 'list', label: t('리스트 뷰', 'List'), Icon: AlignJustify }] as const).map(({ id, label, Icon }) => <button key={id} type="button" aria-label={label} title={label} aria-pressed={layout === id} onClick={() => onChangeLayout(id)}><Icon size={17} /></button>)}</div></SettingRow>;
}
export type ArticleSort = 'newest' | 'oldest';
export interface SortSettingProps { sort: ArticleSort; onChangeSort: (sort: ArticleSort) => void }
export function SortSetting({ sort, onChangeSort }: SortSettingProps) {
  return <SettingRow label={t('정렬', 'Sort')} icon={ArrowDownUp}><div className="feedex-segmented" role="group" aria-label={t('정렬', 'Sort')}>{([{ id: 'newest', label: t('최신순', 'Newest') }, { id: 'oldest', label: t('오래된순', 'Oldest') }] as const).map(({ id, label }) => <button key={id} type="button" aria-pressed={sort === id} onClick={() => onChangeSort(id)}>{label}</button>)}</div></SettingRow>;
}
export function AutoRefreshSetting({ autoRefreshMinutes, onChangeAutoRefreshMinutes }: RefreshSettingsProps) {
  return <div><label className="feedex-auto-refresh-setting" title={t('바뀐 내용만 가볍게 확인해요', 'Quickly checks only what changed')}><SettingLabel icon={RefreshCw}>{t('자동 새로고침', 'Auto refresh')}</SettingLabel><select aria-label={t('자동 새로고침 주기', 'Auto refresh interval')} value={autoRefreshMinutes} onChange={(event) => onChangeAutoRefreshMinutes(Number(event.target.value))}>{AUTO_REFRESH_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? t(`${minutes}분마다`, `Every ${minutes} min`) : t('수동', 'Manual')}</option>)}</select></label></div>;
}
export interface DesktopSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, LayoutSettingsProps { accountId?: string; onManageArticleBlocks?: () => void }
export function DesktopReadingSettings({ autoRefreshMinutes, onChangeAutoRefreshMinutes, layout, onChangeLayout, accountId, onManageArticleBlocks, ...props }: DesktopSettingsProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  // 앱 배율을 연속해서 조절할 수 있도록 맥에서는 크기가 바뀌어도 설정창을 유지한다.
  useOutsideDismiss(ref, inNativeApp());
  return <details ref={ref} className="feedex-desktop-settings" onKeyDown={(event) => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label={t('환경설정', 'Settings')}><Settings2 size={17} /></summary>
    <div className="feedex-desktop-settings-panel">
      <SettingGroup title={t('보기', 'View')}><LanguageSetting /><NativeAppScaleSetting /><TextSizeSetting /><LayoutSetting layout={layout} onChangeLayout={onChangeLayout} /></SettingGroup>
      <SettingGroup title={t('읽기', 'Reading')}><ScrollReadSetting {...props} /><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />{accountId && <LocalNotificationSetting accountId={accountId} />}</SettingGroup>
      {accountId && onManageArticleBlocks && <SettingGroup title={t('계정', 'Account')}><ArticleBlockSetting accountId={accountId} onManage={() => { if (ref.current) ref.current.open = false; onManageArticleBlocks(); }} /></SettingGroup>}
      {accountId && <><SettingGroup title={t('번역·요약', 'Translation & summary')}><TranslationSetting key={accountId} /></SettingGroup><SettingGroup title={t('관리', 'Admin')}><XMirrorStatus /></SettingGroup></>}
      {accountId && <SettingGroup title={t('이 기기', 'This device')}><NativeAppUpdateSetting /><CacheSettings accountId={accountId} /></SettingGroup>}
    </div>
  </details>;
}
