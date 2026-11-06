import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";
import { getRequestErrorMessage } from "../../../shared/lib/request-error";
import { Mascot } from "../../../shared/ui/Mascot";
import { guideCopy } from "../model/copy";
import { guidePaths, guideSteps, readGuideProgress, saveGuideProgress, type GuidePath, type GuideProgress } from "../model/guide";
import "./workspace-guide.css";

type WizardProps = {
  workspace: Workspace;
  userId: string;
  accessToken: string;
  onComplete: () => void;
};

const pathIcons: Record<GuidePath, string> = { legal: "§", it: "⌘", custom: "✦" };

export function WorkspaceOnboardingWizard(props: WizardProps) {
  const storageKey = `lumora-onboarding-v2:${props.userId}:${props.workspace.tenantId}`;
  return <WorkspaceGuide key={storageKey} storageKey={storageKey} {...props} />;
}

function WorkspaceGuide({ storageKey, workspace, accessToken, onComplete }: WizardProps & { storageKey: string }) {
  const { locale, t } = useLocale();
  const copy = guideCopy[locale];
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [progress, setProgress] = useState(() => readGuideProgress(storageKey));
  const [file, setFile] = useState<File | null>(null);
  const stepIndex = guideSteps.indexOf(progress.step);
  const step = copy.steps[progress.step];
  const path = copy.paths[progress.goal ?? "custom"];
  const canUpload = workspace.role === "owner" || workspace.role === "editor";
  const finalStep = stepIndex === guideSteps.length - 1;
  const upload = useMutation({
    mutationFn: (document: File) => api.uploadDocument({
      file: document,
      source: `onboarding/${encodeURIComponent(document.name).slice(0, 750)}`,
      accessToken,
      workspaceId: workspace.tenantId
    })
  });

  useEffect(() => {
    stepHeading.current?.focus({ preventScroll: true });
  }, [progress.step]);

  function update(changes: Partial<GuideProgress>) {
    const next = { ...progress, ...changes };
    saveGuideProgress(storageKey, next);
    setProgress(next);
  }

  function advance() {
    if (!progress.goal || upload.isPending) return;
    if (finalStep) onComplete();
    else update({ step: guideSteps[stepIndex + 1] });
  }

  function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file && canUpload && !upload.isPending && !upload.isSuccess) upload.mutate(file);
  }

  return (
    <section className="workspace-guide" aria-labelledby={titleId}>
      <header className="workspace-guide__hero">
        <div>
          <p className="eyebrow">{copy.guideLabel}</p>
          <h1 id={titleId}>{copy.welcome}</h1>
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
            <li className="workspace-guide__step" key={item} aria-current={item === progress.step ? "step" : undefined}>
              <span className="workspace-guide__step-number" aria-hidden="true">{index < stepIndex ? "✓" : index + 1}</span>
              {copy.steps[item].label}
            </li>
          ))}
        </ol>
      </div>

      <div key={progress.step} className="workspace-guide__stage animate-fade-up">
        <div className="workspace-guide__stage-heading">
          <h2 ref={stepHeading} tabIndex={-1}>{step.title}</h2>
          <p>{step.description}</p>
        </div>

        {progress.step === "purpose" && (
          <fieldset className="workspace-guide__choices">
            <legend className="sr-only">{copy.choosePath}</legend>
            {guidePaths.map((id) => (
              <label key={id} className="workspace-guide__choice">
                <input type="radio" name={`guide-path-${titleId}`} value={id} checked={progress.goal === id} onChange={() => update({ goal: id })} />
                <span className="workspace-guide__choice-icon" aria-hidden="true">{pathIcons[id]}</span>
                <span><strong>{copy.paths[id].label}</strong><small>{copy.paths[id].example}</small></span>
              </label>
            ))}
          </fieldset>
        )}

        {progress.step === "knowledge" && (
          <div className="workspace-guide__detail">
            <div className="workspace-guide__example">
              <strong>{copy.sampleDocument}</strong>
              <p>{path.example}</p>
            </div>
            {canUpload ? (
              <form className="grid w-full gap-3" onSubmit={submitUpload} aria-busy={upload.isPending}>
                <label className="grid min-w-0 gap-2 text-sm font-medium text-slate-200">
                  {t("Choose a file (optional)", "Escolha um arquivo (opcional)")}
                  <input className="field min-w-0" type="file" accept=".pdf,.docx,.txt,.md,.markdown" disabled={upload.isPending}
                    aria-describedby={`${titleId}-file-types`}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      upload.reset();
                    }} />
                </label>
                <p id={`${titleId}-file-types`}>{t("PDF, Word (DOCX), plain text, or Markdown.", "PDF, Word (DOCX), texto simples ou Markdown.")}</p>
                <p>{t(
                  "You can add documents later. Choose a file your team is allowed to share here.",
                  "Você também pode adicionar documentos depois. Escolha um arquivo que a equipe tenha autorização para compartilhar neste espaço."
                )}</p>
                <button className="secondary-button w-fit" type="submit" disabled={!file || upload.isPending || upload.isSuccess}>
                  {upload.isPending ? t("Uploading…", "Enviando…") : t("Upload document", "Enviar documento")}
                </button>
                {upload.isSuccess && <p className="workspace-guide__ready" role="status">{t(
                  "File received. You can continue and follow its preparation from your workspace.",
                  "Arquivo recebido. Você pode continuar e acompanhar o processamento pelo seu espaço."
                )}</p>}
                {upload.error && <p className="error-message" role="alert">{getRequestErrorMessage(upload.error, locale)}</p>}
              </form>
            ) : <p>{copy.viewerKnowledge}</p>}
          </div>
        )}

        {progress.step === "answer" && (
          <div className="workspace-guide__detail">
            <div className="workspace-guide__example">
              <strong>{copy.sampleQuestion}</strong>
              <p>{path.question}</p>
            </div>
            <details className="workspace-guide__example">
              <summary>{t("Show the example answer", "Ver a resposta de exemplo")}</summary>
              <div className="mt-3 grid gap-3">
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
          <button type="button" className="secondary-button" disabled={upload.isPending} onClick={() => {
            setFile(null);
            update({ step: guideSteps[stepIndex - 1] });
          }}>{copy.back}</button>
        )}
        <button type="button" className="primary-button ms-auto" onClick={() => {
          if (progress.step === "knowledge" && !upload.isPending) setFile(null);
          advance();
        }} disabled={!progress.goal || upload.isPending}>
          {finalStep ? copy.finish : copy.next} <span aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}
