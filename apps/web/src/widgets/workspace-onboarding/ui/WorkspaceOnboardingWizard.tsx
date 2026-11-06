import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "../../../shared/i18n/locale";
import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { Mascot } from "../../../shared/ui/Mascot";
import { guideCopy } from "../model/copy";
import { guidePaths, guideSteps, readGuideProgress, saveGuideProgress, type GuidePath, type GuideProgress, type GuideStep } from "../model/guide";
import "./workspace-guide.css";

type WizardProps = {
  workspaceId?: string;
  workspaceName?: string;
  role?: "owner" | "editor" | "viewer";
  currentSection: WorkspaceSection;
  hasDocuments?: boolean;
  hasProcessingJobs?: boolean;
  onNavigate: (section: WorkspaceSection | "answer") => void;
  onAsk?: (question: string) => void;
};

const pathIcons: Record<GuidePath, string> = { legal: "§", it: "⌘", custom: "✦" };
const stepIcons: Record<GuideStep, string> = {
  purpose: "✦", team: "◎", knowledge: "▤", processing: "↻", answer: "✎", understand: "❝"
};

export function WorkspaceOnboardingWizard(props: WizardProps) {
  const storageKey = `lumora-onboarding-v1:${props.workspaceId ?? "workspace"}`;
  return <WorkspaceGuide key={storageKey} storageKey={storageKey} {...props} />;
}

function WorkspaceGuide({
  storageKey, workspaceName, role, hasDocuments, hasProcessingJobs, onNavigate, onAsk
}: WizardProps & { storageKey: string }) {
  const { locale } = useLocale();
  const copy = guideCopy[locale];
  const titleId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const guideButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const [progress, setProgress] = useState(() => readGuideProgress(storageKey));

  const steps = guideSteps.filter((step) => role === "owner" || step !== "team");
  const nextIncomplete = steps.find((step) => !progress.completed.includes(step));
  const activeStep = progress.current && steps.includes(progress.current)
    ? progress.current
    : nextIncomplete ?? steps[0];
  const activeIndex = steps.indexOf(activeStep);
  const nextIndex = nextIncomplete ? steps.indexOf(nextIncomplete) : steps.length;
  const coveredCount = steps.filter((step) => progress.completed.includes(step)).length;
  const allCovered = coveredCount === steps.length;
  const path = copy.paths[progress.goal ?? "custom"];
  const canUpload = role === "owner" || role === "editor";

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (progress.collapsed) guideButton.current?.focus();
    else stepHeading.current?.focus();
  }, [activeStep, progress.collapsed]);

  function update(changes: Partial<GuideProgress>) {
    const next = { ...progress, ...changes };
    saveGuideProgress(storageKey, next);
    setProgress(next);
  }

  function openStep(step: GuideStep) {
    if (step === activeStep) return;
    moveFocus.current = true;
    update({ current: step });
  }

  function advance() {
    if (activeStep === "purpose" && !progress.goal) return;

    const completed = progress.completed.includes(activeStep) ? progress.completed : [...progress.completed, activeStep];
    const following = steps[activeIndex + 1] ?? steps.find((step) => !completed.includes(step));
    moveFocus.current = true;
    update({ completed, current: following ?? activeStep, collapsed: !following });
  }

  function openGuide() {
    moveFocus.current = true;
    update({ current: allCovered ? steps[0] : activeStep, collapsed: false });
  }

  function openSection(section: WorkspaceSection | "answer") {
    update({ current: activeStep });
    onNavigate(section);
  }

  function tryQuestion() {
    if (!onAsk) {
      openSection("answer");
      return;
    }
    update({ current: activeStep });
    onAsk(path.question);
  }

  if (progress.collapsed) {
    return <section className="workspace-guide workspace-guide--compact" aria-labelledby={titleId}>
      <span className="workspace-guide__compact-icon" aria-hidden="true">{allCovered ? "✓" : "✦"}</span>
      <div className="workspace-guide__compact-copy">
        <h3 id={titleId}>{allCovered ? copy.done : copy.guideLabel}</h3>
        <p>{allCovered ? copy.completed : copy.saved}</p>
      </div>
      <div className="workspace-guide__actions">
        <button type="button" className="secondary-button" ref={guideButton} onClick={openGuide}>
          {allCovered ? copy.review : copy.resume}
        </button>
        {allCovered && <button type="button" className="primary-button" onClick={() => openSection("answer")}>{copy.goToAsk}</button>}
      </div>
    </section>;
  }

  const currentCopy = copy.steps[activeStep];
  const progressLabel = copy.progress(coveredCount, steps.length);

  return <section className="workspace-guide" aria-labelledby={titleId}>
    <header className="workspace-guide__hero">
      <div>
        <p className="eyebrow">{copy.guideLabel}</p>
        <h3 id={titleId}>{copy.welcome}</h3>
        <p className="workspace-guide__introduction">
          {workspaceName ? copy.workspaceIntroduction(workspaceName) : copy.introduction}
        </p>
      </div>
      <div className="workspace-guide__mascot" aria-hidden="true">
        <span className="workspace-guide__spark workspace-guide__spark--first">✦</span>
        <span className="workspace-guide__spark workspace-guide__spark--second">✧</span>
        <Mascot />
      </div>
    </header>

    <div className="workspace-guide__progress">
      <div className="workspace-guide__progress-label">
        <span>{copy.stepCount(activeIndex + 1, steps.length)}</span>
        <span role="status">{progressLabel}</span>
      </div>
      <progress value={coveredCount} max={steps.length} aria-label={progressLabel} />
      <ol className="workspace-guide__steps">
        {steps.map((step, index) => {
          const isCurrent = step === activeStep;
          const isCovered = progress.completed.includes(step);
          return <li key={step}>
            <button
              type="button"
              className="workspace-guide__step"
              disabled={index > nextIndex && !isCovered}
              aria-current={isCurrent ? "step" : undefined}
              onClick={() => openStep(step)}
            >
              <span className="workspace-guide__step-number" aria-hidden="true">{isCovered ? "✓" : index + 1}</span>
              {copy.steps[step].label}
            </button>
          </li>;
        })}
      </ol>
    </div>

    <div key={activeStep} className="workspace-guide__stage animate-fade-up">
      <div className="workspace-guide__stage-heading">
        <span className="workspace-guide__stage-icon" aria-hidden="true">{stepIcons[activeStep]}</span>
        <div>
          <h4 ref={stepHeading} tabIndex={-1}>{currentCopy.title}</h4>
          <p>{currentCopy.description}</p>
        </div>
      </div>

      {activeStep === "purpose" && <fieldset className="workspace-guide__choices">
        <legend className="sr-only">{copy.choosePath}</legend>
        {guidePaths.map((id) => <label key={id} className="workspace-guide__choice">
          <input
            type="radio"
            name={`guide-path-${titleId}`}
            value={id}
            checked={progress.goal === id}
            onChange={() => update({ goal: id })}
          />
          <span className="workspace-guide__choice-icon" aria-hidden="true">{pathIcons[id]}</span>
          <span><strong>{copy.paths[id].label}</strong><small>{copy.paths[id].example}</small></span>
        </label>)}
      </fieldset>}

      {activeStep === "team" && <button className="secondary-button" type="button" onClick={() => openSection("team")}>{copy.invite} <span aria-hidden="true">→</span></button>}

      {activeStep === "knowledge" && <div className="workspace-guide__detail">
        <div className="workspace-guide__example">
          <strong>{copy.sampleDocument}</strong>
          <p>{path.example}</p>
        </div>
        <p>{role === "owner" ? copy.ownerKnowledge : role === "editor" ? copy.editorKnowledge : copy.viewerKnowledge}</p>
        {hasDocuments && <p className="workspace-guide__ready"><span aria-hidden="true">✓</span> {copy.documentsAvailable}</p>}
        <button className="secondary-button" type="button" onClick={() => openSection("knowledge")}>
          {canUpload && !hasDocuments ? copy.addDocument : copy.openLibrary} <span aria-hidden="true">→</span>
        </button>
      </div>}

      {activeStep === "processing" && <div className="workspace-guide__detail">
        <ol className="workspace-guide__pipeline">
          {copy.processingStages.map((stage, index) => <li key={stage}><span aria-hidden="true">{index + 1}</span>{stage}</li>)}
        </ol>
        <p>{hasProcessingJobs ? copy.jobsAvailable : copy.noJobs}</p>
        <button className="secondary-button" type="button" onClick={() => openSection("processing")}>{copy.openProcessing} <span aria-hidden="true">→</span></button>
      </div>}

      {activeStep === "answer" && <div className="workspace-guide__detail">
        <div className="workspace-guide__example">
          <strong>{copy.questionLabel}</strong>
          <p>{path.question}</p>
        </div>
        <button className="secondary-button" type="button" onClick={tryQuestion}>{onAsk ? copy.tryQuestion : copy.openAsk} <span aria-hidden="true">→</span></button>
      </div>}

      {activeStep === "understand" && <div className="workspace-guide__detail">
        <details className="workspace-guide__example">
          <summary>{copy.sampleSource}</summary>
          <blockquote>
            <p>{path.excerpt}</p>
            <cite>{path.source}</cite>
          </blockquote>
        </details>
        <p>{copy.similarity}</p>
      </div>}
    </div>

    <footer className="workspace-guide__footer">
      <button type="button" className="workspace-guide__quiet" onClick={() => {
        moveFocus.current = true;
        update({ current: activeStep, collapsed: true });
      }}>{copy.close}</button>
      <div className="workspace-guide__actions">
        {activeIndex > 0 && <button type="button" className="secondary-button" onClick={() => openStep(steps[activeIndex - 1])}>{copy.back}</button>}
        <button type="button" className="primary-button" onClick={advance} disabled={activeStep === "purpose" && !progress.goal}>
          {activeIndex === steps.length - 1 ? copy.finish : copy.next} <span aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  </section>;
}
