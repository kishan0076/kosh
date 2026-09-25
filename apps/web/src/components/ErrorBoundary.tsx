import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Catches render/lifecycle exceptions in its subtree so a single throw (e.g. a malformed node folded
 * in by live-sync, surfacing on the next render) shows an in-place recovery card instead of
 * white-screening the app. Pass a `resetKey` (e.g. the full location) so navigating away clears a
 * caught error automatically, during render, with no fallback flash.
 *
 * Note: an error boundary only catches errors thrown during descendants' render/lifecycle — not in
 * event handlers or async callbacks. A store mutation that stores bad data won't throw here, but the
 * bad render it later causes will. When the fault is persistent module state, "Reload page" is the
 * reliable recovery (hence it is the primary action); "Try again" only helps a transient error.
 */
interface Props {
  children: ReactNode;
  /** When this changes, a caught error is cleared during render (e.g. on route/folder change). */
  resetKey?: unknown;
  /** Short label for the failing area, used in the recovery copy. */
  label?: string;
}
interface State {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /** Clear a caught error during render (no fallback flash) whenever the reset key changes. */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for local debugging + any wired error monitoring; never swallow silently.
    console.error("[ErrorBoundary] uncaught render error", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="grid min-h-[55vh] w-full place-items-center">
        <div className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface px-6 py-10 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger">
            <AlertTriangle size={26} />
          </span>
          <h1 className="text-lg font-semibold">Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">
            This view hit an unexpected error and stopped rendering. Your files are safe — reloading usually clears it.
          </p>
          {error.message && (
            <p className="mx-auto mt-3 max-w-sm break-words rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-left font-mono text-[12px] text-muted sm:text-[11.5px]">
              {error.message}
            </p>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="primary" autoFocus onClick={() => window.location.reload()}>
              <RefreshCw size={15} /> Reload page
            </Button>
            <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }
}
