import { useRef, type ReactNode } from 'react';
import { Minus, Plus, Settings2, LayoutList, LayoutGrid, AlignJustify } from 'lucide-react';
import type { LayoutMode } from '../client/api';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';
import { ArticleBlockSetting } from './ArticleBlockDialog';
import { FONT_SCALES, useTextSize } from '../client/textSize';
import { AUTO_REFRESH_OPTIONS } from '../shared/preferences';
import { useOutsideDismiss } from '../client/outsideDismiss';
import { inNativeApp, nativeAppName, nativeBridge, nativePlatform, useNativeAppScale } from '../client/nativeApp';

export interface ScrollReadSettingsProps {
  markReadOnScroll: boolean;
  onChangeMarkReadOnScroll: (enabled: boolean) => void;
}

export function TextSizeControl({ className = '' }: { className?: string }) {
  const [size, setSize] = useTextSize();
  const index = FONT_SCALES.indexOf(size);
  return <div role="group" aria-label="글자 크기" className={`feedex-text-size-control ${className}`}>
    <button type="button" aria-label="글자 작게" disabled={index === 0} onClick={() => setSize(FONT_SCALES[index - 1])}><Minus size={18} /></button>
    <button type="button" aria-label="기본 글자 크기로" onClick={() => setSize(1)}><span aria-hidden="true">가</span></button>
    <button type="button" aria-label="글자 크게" disabled={index === FONT_SCALES.length - 1} onClick={() => setSize(FONT_SCALES[index + 1])}><Plus size={18} /></button>
  </div>;
}

/** 설정은 제목 붙은 묶음으로 나뉜다. 구분선은 설정마다가 아니라 묶음 사이에만 긋는다. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="feedex-setting-group" aria-label={title}><p className="feedex-setting-group-title">{title}</p><div className="feedex-setting-items">{children}</div></section>;
}
/** 설정 하나: 왼쪽에 이름, 오른쪽에 조절기. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="feedex-setting-row"><span>{label}</span>{children}</div>;
}
/** 데스크톱 앱의 전체 화면 크기. 기사 글자 크기와 구별하고 브라우저에서는 표시하지 않는다. */
export function NativeAppScaleSetting() {
  const scale = useNativeAppScale();
  if (!inNativeApp()) return null;
  const change = (action: 'smaller' | 'larger' | 'reset') => nativeBridge()?.postMessage({ type: 'appScale', action });
  return <SettingRow label="앱 화면 크기"><div className="feedex-text-size-control" role="group" aria-label="앱 화면 크기">
    <button type="button" aria-label="앱 화면 작게" disabled={scale <= 0.5} onClick={() => change('smaller')}><Minus size={18} /></button>
    <button type="button" aria-label="앱 화면 기본 크기로" title="기본 크기로" onClick={() => change('reset')}>기본</button>
    <button type="button" aria-label="앱 화면 크게" disabled={scale >= 1.5} onClick={() => change('larger')}><Plus size={18} /></button>
  </div></SettingRow>;
}

export function NativeAppUpdateSetting() {
  if (!inNativeApp()) return null;
  // 맥 앱은 Sparkle이 받아서 설치하고, 윈도우 앱은 새 버전을 알려 주고 받을 파일을 연다.
  const detail = nativePlatform() === 'windows' ? '새 버전이 있으면 받을 파일을 열어요' : '새 버전이 있으면 받아서 설치해요';
  return <div className="feedex-auto-refresh-setting"><span>{nativeAppName()} 업데이트<small>{detail}</small></span><button type="button" className="feedex-cache-clear" onClick={() => nativeBridge()?.postMessage({ type: 'checkForUpdates' })}>업데이트 확인</button></div>;
}

export function TextSizeSetting() {
  return <SettingRow label="글자 크기"><TextSizeControl /></SettingRow>;
}

export function ScrollReadSetting({ markReadOnScroll, onChangeMarkReadOnScroll }: ScrollReadSettingsProps) {
  return <label className="feedex-scroll-read-setting"><span>스크롤 시 읽음 처리<small>위로 지나간 글을 읽음으로 표시</small></span><input type="checkbox" role="switch" aria-label="스크롤 시 읽음 처리" checked={markReadOnScroll} onChange={(event) => onChangeMarkReadOnScroll(event.target.checked)} /></label>;
}

export interface RefreshSettingsProps {
  autoRefreshMinutes: number;
  onChangeAutoRefreshMinutes: (minutes: number) => void;
}
export interface LayoutSettingsProps { layout: LayoutMode; onChangeLayout: (layout: LayoutMode) => void }
export function LayoutSetting({ layout, onChangeLayout }: LayoutSettingsProps) {
  return <SettingRow label="목록 보기"><div className="feedex-segmented" role="group" aria-label="목록 보기">{([{ id: 'magazine', label: '매거진 뷰', Icon: LayoutList }, { id: 'cards', label: '카드 뷰', Icon: LayoutGrid }, { id: 'list', label: '리스트 뷰', Icon: AlignJustify }] as const).map(({ id, label, Icon }) => <button key={id} type="button" aria-label={label} title={label} aria-pressed={layout === id} onClick={() => onChangeLayout(id)}><Icon size={17} /></button>)}</div></SettingRow>;
}
export type ArticleSort = 'newest' | 'oldest';
export interface SortSettingProps { sort: ArticleSort; onChangeSort: (sort: ArticleSort) => void }
export function SortSetting({ sort, onChangeSort }: SortSettingProps) {
  return <SettingRow label="정렬"><div className="feedex-segmented" role="group" aria-label="정렬">{([{ id: 'newest', label: '최신순' }, { id: 'oldest', label: '오래된순' }] as const).map(({ id, label }) => <button key={id} type="button" aria-pressed={sort === id} onClick={() => onChangeSort(id)}>{label}</button>)}</div></SettingRow>;
}
export function AutoRefreshSetting({ autoRefreshMinutes, onChangeAutoRefreshMinutes }: RefreshSettingsProps) {
  return <div><label className="feedex-auto-refresh-setting"><span>자동 새로고침<small>바뀐 내용만 가볍게 확인해요</small></span><select aria-label="자동 새로고침 주기" value={autoRefreshMinutes} onChange={(event) => onChangeAutoRefreshMinutes(Number(event.target.value))}>{AUTO_REFRESH_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes}분마다` : '수동'}</option>)}</select></label></div>;
}
export interface DesktopSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, LayoutSettingsProps { accountId?: string; onManageArticleBlocks?: () => void }
export function DesktopReadingSettings({ autoRefreshMinutes, onChangeAutoRefreshMinutes, layout, onChangeLayout, accountId, onManageArticleBlocks, ...props }: DesktopSettingsProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  // 앱 배율을 연속해서 조절할 수 있도록 맥에서는 크기가 바뀌어도 설정창을 유지한다.
  useOutsideDismiss(ref, inNativeApp());
  return <details ref={ref} className="feedex-desktop-settings" onKeyDown={(event) => { if (event.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label="환경설정"><Settings2 size={17} /></summary>
    <div className="feedex-desktop-settings-panel">
      <SettingGroup title="보기"><NativeAppScaleSetting /><TextSizeSetting /><LayoutSetting layout={layout} onChangeLayout={onChangeLayout} /></SettingGroup>
      <SettingGroup title="읽기"><ScrollReadSetting {...props} /></SettingGroup>
      <SettingGroup title="새 글"><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />{accountId && <LocalNotificationSetting accountId={accountId} />}</SettingGroup>
      {accountId && onManageArticleBlocks && <SettingGroup title="계정"><ArticleBlockSetting accountId={accountId} onManage={() => { if (ref.current) ref.current.open = false; onManageArticleBlocks(); }} /></SettingGroup>}
      {accountId && <SettingGroup title="이 기기"><NativeAppUpdateSetting /><CacheSettings accountId={accountId} /></SettingGroup>}
    </div>
  </details>;
}
