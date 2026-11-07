import { Component, lazy, useId, useState, type ReactNode } from "react";
import { useLocale } from "../i18n/locale";
import { reportRenderFailure, type ClientSurface } from "../lib/client-diagnostics";

type Props = { children: ReactNode; surface: ClientSurface; onRetry?: () => void };

export class SectionErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    reportRenderFailure(this.props.surface);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <SectionRecovery onRetry={() => {
      if (this.props.onRetry) this.props.onRetry();
      else this.setState({ failed: false });
    }} />;
  }
}

function SectionRecovery({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  const titleId = useId();
  return <section className="empty-state space-y-4" role="alert" aria-labelledby={titleId}>
    <h2 id={titleId} className="text-lg font-semibold text-white">
      {t("We could not open this section", "Não conseguimos abrir esta seção")}
    </h2>
    <p>{t("Try again or open another section. You can reload the page if the problem continues.",
      "Tente novamente ou abra outra seção. Se o problema continuar, recarregue a página.")}</p>
    <div className="flex flex-wrap gap-3">
      <button autoFocus type="button" className="primary-button" onClick={onRetry}>
        {t("Try again", "Tentar novamente")}
      </button>
      <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
        {t("Reload page", "Recarregar página")}
      </button>
    </div>
  </section>;
}

export function lazyWithRecovery<Props extends object>(
  load: () => Promise<{ default: (props: Props) => ReactNode }>, surface: ClientSurface,
) {
  // A first render can suspend before state commits. Keep that lazy identity stable.
  const Initial = lazy(load);
  return function RecoverableLazy(props: Props) {
    const [attempt, setAttempt] = useState(() => ({ Component: Initial, revision: 0 }));
    const Loaded = attempt.Component;
    return <SectionErrorBoundary key={attempt.revision} surface={surface} onRetry={() =>
      setAttempt((current) => ({ Component: lazy(load), revision: current.revision + 1 }))}>
      <Loaded {...props} />
    </SectionErrorBoundary>;
  };
}
