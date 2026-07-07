import { Component, type ErrorInfo, type ReactNode } from 'react';
import { translateMessage } from './i18n/I18nProvider.js';

interface RendererErrorBoundaryProps {
  readonly children: ReactNode;
}

interface RendererErrorBoundaryState {
  readonly hasError: boolean;
  readonly message: string | null;
}

export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  override state: RendererErrorBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): RendererErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[kodax-space] renderer root render failed', {
      error,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-surface p-6 text-fg-primary">
        <div className="w-full max-w-[520px] rounded-lg border border-danger/40 bg-surface-2 p-5 text-center shadow-xl">
          <div className="text-base font-semibold">{translateMessage('renderer.renderError')}</div>
          {this.state.message && (
            <div className="mt-3 break-words rounded-md border border-border-default bg-surface px-3 py-2 text-left font-mono text-xs leading-relaxed text-fg-muted">
              {this.state.message}
            </div>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md border border-border-default px-3 py-1.5 text-sm text-fg-secondary hover:bg-surface-3 hover:text-fg-primary"
          >
            {translateMessage('renderer.reload')}
          </button>
        </div>
      </div>
    );
  }
}
