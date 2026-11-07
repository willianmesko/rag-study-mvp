import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceOnboardingProgress } from "@rag-study/contracts";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { Mascot } from "../../../shared/ui/Mascot";
import { guideCopy } from "../model/copy";
import {
  guidePaths,
  guideSteps,
  resolveGuidePath,
  type GuidePath,
  type GuideStep,
} from "../model/guide";
import { GuideKnowledge } from "./GuideKnowledge";
import { GuideConcepts } from "./GuideConcepts";
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
  onComplete: (conversationId?: string) => void;
};

const pathIcons: Record<GuidePath, string> = {
  knowledge: "▤",
  support: "◇",
  learning: "✦",
};

export function WorkspaceOnboardingWizard({
  workspace,
  accessToken,
  scope,
  progress,
  onProgress,
  onComplete,
  replay = false,
  onPendingChange,
  onAnswered,
}: WizardProps) {
  const { locale, t } = useLocale();
  const copy = guideCopy[locale];
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [navigationStep, setNavigationStep] = useState<GuideStep | null>(
    replay ? "purpose" : null,
  );
  const [documentBusy, setDocumentBusy] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [documentReady, setDocumentReady] = useState(false);
  const [answerReady, setAnswerReady] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const busy = documentBusy || answerBusy;
  const Title = replay ? "h2" : "h1";
  const currentStep = navigationStep ?? progress.step;
  const stepIndex = guideSteps.indexOf(currentStep);
  const step = copy.steps[currentStep];
  const selectedPath = resolveGuidePath(progress.goal);
  const finalStep = stepIndex === guideSteps.length - 1;
  useEffect(() => {
    onPendingChange?.(busy);
    return () => onPendingChange?.(false);
  }, [busy, onPendingChange]);

  useEffect(() => {
    stepHeading.current?.focus({ preventScroll: true });
  }, [currentStep]);

  const canAdvance =
    Boolean(progress.goal) &&
    !busy &&
    (currentStep !== "knowledge" || documentReady) &&
    (currentStep !== "answer" || replay || answerReady);
  function advance() {
    if (!canAdvance) return;
    if (finalStep) {
      onComplete(conversationId);
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
          <p className="eyebrow" role="status">
            {copy.stepCount(stepIndex + 1, guideSteps.length)} · {step.label}
          </p>
          <Title
            id={titleId}
            ref={stepHeading}
            tabIndex={-1}
            className="outline-none"
          >
            {step.title}
          </Title>
          <p className="workspace-guide__introduction">
            {currentStep === "knowledge"
              ? copy.paths[selectedPath].example
              : step.description}
          </p>
        </div>
        <div className="workspace-guide__mascot" aria-hidden="true">
          <Mascot decorative size="sm" />
        </div>
      </header>
      <progress
        value={stepIndex + 1}
        max={guideSteps.length}
        aria-label={copy.guideLabel}
      />
      <div key={currentStep} className="workspace-guide__stage animate-fade-up">
        {currentStep === "purpose" && (
          <fieldset className="workspace-guide__choices">
            <legend className="sr-only">{copy.choosePath}</legend>
            {guidePaths.map((id) => (
              <label key={id} className="workspace-guide__choice">
                <input
                  type="radio"
                  name={`guide-path-${titleId}`}
                  value={id}
                  checked={progress.goal !== null && selectedPath === id}
                  onChange={() => onProgress({ goal: id })}
                />
                <span
                  className="workspace-guide__choice-icon"
                  aria-hidden="true"
                >
                  {pathIcons[id]}
                </span>
                <span>
                  <strong>{copy.paths[id].label}</strong>
                  <small>{copy.paths[id].example}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {currentStep === "knowledge" && (
          <>
            <GuideKnowledge
              key={selectedPath}
              workspace={workspace}
              token={accessToken}
              goal={selectedPath}
              onPendingChange={setDocumentBusy}
              onReadyChange={setDocumentReady}
            />
          </>
        )}

        {currentStep === "answer" && (
          <GuidePractice
            key={selectedPath}
            workspace={workspace}
            token={accessToken}
            scope={scope}
            goal={selectedPath}
            onPendingChange={setAnswerBusy}
            onReadyChange={setAnswerReady}
            onConversationReady={setConversationId}
            onAnswered={onAnswered}
          />
        )}
      </div>

      <footer className="workspace-guide__footer">
        {stepIndex > 0 ? (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setNavigationStep(guideSteps[stepIndex - 1])}
          >
            {copy.back}
          </button>
        ) : (
          <span />
        )}
        {!replay && (
          <button
            type="button"
            className="text-action min-h-11 px-2"
            disabled={busy}
            onClick={() => onComplete()}
            title={t(
              "Reopen Milo's guide from Help whenever you like.",
              "Reabra o guia do Milo em Ajuda quando quiser.",
            )}
          >
            {t("Continue later", "Continuar depois")}
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          onClick={advance}
          disabled={!canAdvance}
        >
          {finalStep
            ? replay
              ? t("Close guide", "Fechar guia")
              : copy.finish
            : copy.next}{" "}
          <span aria-hidden="true">→</span>
        </button>
      </footer>
      {replay && <GuideConcepts />}
    </section>
  );
}
