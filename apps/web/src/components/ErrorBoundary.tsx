import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Catches render/lifecycle exceptions in its subtree so a single throw (e.g. a malformed node folded
 * in by live-sync) shows an in-place recovery card instead of white-screening the whole app. Pass a
 * `resetKey` (e.g. the route path) so navigating away clears a caught error automatically.
 */
interface Props {
  children: ReactNode;
  /** When this value changes, a previously-caught error is cleared (e.g. on route change). */
  resetKey?: unknown;
  /** Short label for the failing area, used in the recovery copy. */
  label?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for local debugging + any wired error monitoring; never swallow silently.
    console.error("[ErrorBoundary] uncaught render error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Auto-recover when the caller's reset key changes (e.g. the user navigated to another route).
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid min-h-[55vh] w-full place-items-center">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger">
            <AlertTriangle size={26} />
          </span>
          <h1 className="text-lg font-semibold">Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">
            This view hit an unexpected error and stopped rendering. Your files are safe — reloading usually clears it.
          </p>
          {error.message && (
            <p className="mx-auto mt-3 max-w-sm break-words rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 font-mono text-[11.5px] text-muted">
              {error.message}
            </p>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              <RefreshCw size={15} /> Try again
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}
