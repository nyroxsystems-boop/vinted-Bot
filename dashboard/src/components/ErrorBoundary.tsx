import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary — prevents a single React crash from whiting out
 * the entire dashboard. Wraps each page route so failures are isolated.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mx-auto mt-16 max-w-lg space-y-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-rose-300">
            <AlertTriangle size={18} />
            {this.props.fallbackTitle ?? 'Seite konnte nicht geladen werden'}
          </h2>
          <pre className="overflow-auto rounded-md border border-rose-500/20 bg-zinc-950/60 p-3 text-xs text-rose-200">
            {this.state.error?.message ?? 'Unknown error'}
          </pre>
          <p className="text-sm text-rose-200/80">
            Die anderen Seiten funktionieren weiterhin. Versuche es erneut oder wechsle zu einer anderen Seite.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn-danger"
          >
            Erneut versuchen
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
