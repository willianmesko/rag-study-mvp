import { Component, type ReactNode } from "react";
import { useLocale } from "../shared/i18n/locale";
import { reportRenderFailure } from "../shared/lib/client-diagnostics";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch() {
    reportRenderFailure("application");
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <RecoveryScreen />;
  }
}

function RecoveryScreen() {
  const { t } = useLocale();
  return (
    <main className="app-shell grid min-h-screen place-items-center px-6 text-slate-100">
      <section className="panel w-full max-w-lg text-center">
        <p className="eyebrow">{t("Lumora recovery", "Recuperação do Lumora")}</p>
        <h1 className="mt-3 text-2xl font-semibold text-white">{t("We could not open this workspace", "Não conseguimos abrir este espaço de trabalho")}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {t("Reload the page and try again. If this keeps happening, sign out and sign in again.",
             "Recarregue a página e tente de novo. Se o problema continuar, saia e entre novamente.")}
        </p>
        <button className="primary-button mt-6" type="button" onClick={() => window.location.reload()}>
          {t("Reload workspace", "Recarregar página")}
        </button>
      </section>
    </main>
  );
}
