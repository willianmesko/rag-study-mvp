import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Lumora rendering error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="app-shell grid min-h-screen place-items-center px-6 text-slate-100"><section className="panel w-full max-w-lg text-center"><p className="eyebrow">Lumora recovery</p><h1 className="mt-3 text-2xl font-semibold text-white">We could not open this workspace</h1><p className="mt-3 text-sm leading-6 text-slate-400">Your session is safe. Reload the page and try again. If this keeps happening, sign out and sign in again.</p><button className="primary-button mt-6" type="button" onClick={() => window.location.reload()}>Reload workspace</button></section></main>;
  }
}
