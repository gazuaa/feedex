import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React Error in ErrorBoundary:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      return (
        <div
          role="alert"
          aria-live="assertive"
          className={`flex h-full min-h-[300px] w-full flex-col items-center justify-center p-6 text-center ${
            isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
          }`}
        >
          <div
            className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${
              isDark ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600'
            }`}
          >
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-lg font-bold">
            {this.props.fallbackTitle || '화면을 표시하는 중 오류가 발생했습니다'}
          </h2>
          <p className="mb-6 max-w-md text-xs text-slate-400 leading-relaxed">
            {this.state.error?.message || '일시적인 렌더링 오류일 수 있습니다. 다시 시도해 주세요.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              <span>다시 시도</span>
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className={`rounded-xl border px-4 py-2.5 text-xs font-semibold transition cursor-pointer ${
                isDark
                  ? 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
