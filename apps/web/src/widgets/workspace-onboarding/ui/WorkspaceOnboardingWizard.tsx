import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { guideCopy } from "../model/copy";
import { guidePaths, guideSteps, resolveGuidePath, type GuidePath, type GuideStep } from "../model/guide";
import { GuideKnowledge } from "./GuideKnowledge";
import { GuidePractice, type GuideAnsweredQuestion } from "./GuidePractice";
import "./workspace-guide.css";

type WizardProps = {
  workspace: Workspace;
  accessToken: string;
  progress: WorkspaceOnboardingProgress;
  scope: string;
  replay?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onAnswered?: (input: GuideAnsweredQuestion) => void;
  onProgress: (changes: Partial<WorkspaceOnboardingProgress>) => void;
  onComplete: () => void;
};

const pathIcons: Record<GuidePath, string> = { knowledge: "▤", support: "◇", learning: "✦" };

export function WorkspaceOnboardingWizard({ workspace, accessToken, scope, progress, onProgress, onComplete, replay = false, onPendingChange, onAnswered }: WizardProps) {
  const { locale, t } = useLocale();
  const copy = guideCopy[locale];
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [navigationStep, setNavigationStep] = useState<GuideStep | null>(replay ? "purpose" : null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const busy = documentBusy || answerBusy;
  const Title = replay ? "h2" : "h1";
  const currentStep = navigationStep ?? progress.step;
  const stepIndex = guideSteps.indexOf(currentStep);
  const step = copy.steps[currentStep];
  const selectedPath = resolveGuidePath(progress.goal);
  const path = copy.paths[selectedPath];
  const finalStep = stepIndex === guideSteps.length - 1;
  useEffect(() => {
    onPendingChange?.(busy);
    return () => onPendingChange?.(false);
  }, [busy, onPendingChange]);

  useEffect(() => {
    stepHeading.current?.focus({ preventScroll: true });
  }, [currentStep]);

  function advance() {
    if (!progress.goal || busy) return;
    if (finalStep) {
      onComplete();
      return;
    }
    const nextStep = guideSteps[stepIndex + 1];
    const furthestIndex = guideSteps.indexOf(progress.step);
    setNavigationStep(stepIndex + 1 < furthestIndex ? nextStep : null);
    if (stepIndex + 1 > furthestIndex) onProgress({ step: nextStep });
  }

  return (
    <section className="workspace-guide" aria-labelledby={titleId}>
      <header className="workspace-guide__hero">
        <div>
          <p className="eyebrow">{copy.guideLabel}</p>
          <Title id={titleId}>{copy.welcome}</Title>
          <p className="workspace-guide__introduction">{copy.workspaceIntroduction(workspace.tenantName)}</p>
        </div>
        <div className="workspace-guide__mascot" aria-hidden="true">
          <span className="workspace-guide__spark workspace-guide__spark--first">✦</span>
          <span className="workspace-guide__spark workspace-guide__spark--second">✧</span>
          <Mascot decorative />
        </div>
      </header>

      <div className="workspace-guide__progress">
        <p className="workspace-guide__progress-label" role="status">
          <span>{copy.stepCount(stepIndex + 1, guideSteps.length)}</span>
        </p>
        <progress value={stepIndex + 1} max={guideSteps.length} aria-label={copy.guideLabel} />
        <ol className="workspace-guide__steps">
          {guideSteps.map((item, index) => (
            <li className="workspace-guide__step" key={item} aria-current={item === currentStep ? "step" : undefined}>
              <span className="workspace-guide__step-number" aria-hidden="true">{index < stepIndex ? "✓" : index + 1}</span>
              {copy.steps[item].label}
            </li>
          ))}
        </ol>
      </div>

      <div key={currentStep} className="workspace-guide__stage animate-fade-up">
        <div className="workspace-guide__stage-heading">
          <h2 ref={stepHeading} tabIndex={-1}>{step.title}</h2>
          <p>{currentStep === "knowledge" ? path.example : step.description}</p>
        </div>

        {currentStep === "purpose" && (
          <fieldset className="workspace-guide__choices">
            <legend className="sr-only">{copy.choosePath}</legend>
            {guidePaths.map((id) => (
              <label key={id} className="workspace-guide__choice">
                <input type="radio" name={`guide-path-${titleId}`} value={id} checked={progress.goal !== null && selectedPath === id} onChange={() => onProgress({ goal: id })} />
                <span className="workspace-guide__choice-icon" aria-hidden="true">{pathIcons[id]}</span>
                <span><strong>{copy.paths[id].label}</strong><small>{copy.paths[id].example}</small></span>
              </label>
            ))}
          </fieldset>
        )}

        {currentStep === "knowledge" && <>
          <GuideKnowledge key={selectedPath} workspace={workspace} token={accessToken} goal={selectedPath} onPendingChange={setDocumentBusy} />
        </>}

        {currentStep === "answer" && (
          <div className="workspace-guide__detail">
            <GuidePractice key={selectedPath} workspace={workspace} token={accessToken} scope={scope} goal={selectedPath}
              onPendingChange={setAnswerBusy} onAnswered={onAnswered} />
            <details className="workspace-guide__example">
              <summary>{t("Show the example answer", "Ver a resposta de exemplo")}</summary>
              <div className="mt-3 grid gap-3">
                <p>{t("This illustration is fictional. Use a prepared workspace document for real questions.", "Esta ilustração é fictícia. Use um documento pronto do espaço para fazer perguntas reais.")}</p>
                <p><strong>{copy.sampleQuestion}</strong><br />{path.question}</p>
                <p><strong>{copy.sampleAnswer}</strong><br />{path.answer}</p>
                <details className="workspace-guide__example">
                  <summary>{copy.sampleSource}</summary>
                  <blockquote><p>{path.excerpt}</p><cite>{path.source}</cite></blockquote>
                </details>
              </div>
            </details>
            <p>{copy.similarity}</p>
          </div>
        )}
      </div>

      <footer className="workspace-guide__footer">
        {stepIndex > 0 && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => {
            setNavigationStep(guideSteps[stepIndex - 1]);
          }}>{copy.back}</button>
        )}
        <button type="button" className="primary-button ms-auto" onClick={advance} disabled={!progress.goal || busy}>
          {finalStep ? replay ? t("Close guide", "Fechar guia") : copy.finish : copy.next} <span aria-hidden="true">→</span>
        </button>
      </footer>
      {stepIndex > 0 && !replay && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-700 pt-4">
        <button type="button" className="text-action min-h-11" disabled={busy} onClick={onComplete}>{t("Finish for now", "Concluir por enquanto")}</button>
        <p className="text-xs text-slate-300">{t("You can return to Milo’s guide from Help in your workspace.", "Você pode voltar ao guia do Milo em Ajuda no seu espaço.")}</p>
      </div>}
    </section>
  );
}
