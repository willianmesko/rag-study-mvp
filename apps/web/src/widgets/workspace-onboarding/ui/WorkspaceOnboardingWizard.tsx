import { useMemo, useState } from "react";
import type { WorkspaceSection } from "../../../shared/lib/app-route";

type OnboardingStep = { id: string; title: string; description: string; section: WorkspaceSection | "answer" };

const steps: OnboardingStep[] = [
  { id: "purpose", title: "Choose a goal", description: "Tell Lumora what your team wants to make easier.", section: "settings" },
  { id: "knowledge", title: "Add trusted knowledge", description: "Upload the internal material your team already uses.", section: "knowledge" },
  { id: "processing", title: "Watch the preparation", description: "See extraction, chunking, safety checks, and indexing.", section: "processing" },
  { id: "answer", title: "Ask your first question", description: "Get an answer with sources from the selected workspace.", section: "answer" },
  { id: "understand", title: "Read the evidence", description: "Inspect citations and learn why similarity is not certainty.", section: "overview" }
];

function readState(storageKey: string) {
  try { return JSON.parse(window.localStorage.getItem(storageKey) ?? "{}"); } catch { return {}; }
}

export function WorkspaceOnboardingWizard({ workspaceId, currentSection, onNavigate }: { workspaceId?: string; currentSection: WorkspaceSection; onNavigate: (section: WorkspaceSection | "answer") => void }) {
  const storageKey = `lumora-onboarding-v1:${workspaceId ?? "workspace"}`;
  const [expanded, setExpanded] = useState(() => window.localStorage.getItem(storageKey) === null);
  const [goal, setGoal] = useState<string>(() => readState(storageKey).goal ?? "");
  const [completed, setCompleted] = useState<string[]>(() => Array.isArray(readState(storageKey).completed) ? readState(storageKey).completed : []);
  const doneCount = completed.length;
  const nextStep = useMemo(() => steps.find((step) => !completed.includes(step.id)), [completed]);

  function persist(nextGoal: string, nextCompleted: string[]) {
    window.localStorage.setItem(storageKey, JSON.stringify({ goal: nextGoal, completed: nextCompleted, updatedAt: new Date().toISOString() }));
  }

  function markDone(id: string) {
    const next = completed.includes(id) ? completed : [...completed, id];
    setCompleted(next); persist(goal, next);
  }

  if (!expanded && doneCount === steps.length) return <button type="button" className="onboarding-complete-banner" onClick={() => setExpanded(true)}><span>✓ Onboarding complete</span><span>Review the workspace guide →</span></button>;
  return <section className={`onboarding-card ${expanded ? "onboarding-card--expanded" : ""}`}>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Getting started</p><h3 className="mt-2 text-xl font-semibold text-white">A clear first path for your team</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">For example, a law firm can keep internal playbooks, templates, and matter guidance in one searchable workspace—without sending keys or infrastructure details to the browser.</p></div><div className="flex items-center gap-2"><span className="status-pill">{doneCount}/{steps.length} complete</span><button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse" : "Open guide"}</button></div></div>
    {expanded && <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]"><div className="space-y-3">{steps.map((step, index) => { const isDone = completed.includes(step.id); const isCurrent = nextStep?.id === step.id || (!nextStep && currentSection === "overview"); return <article key={step.id} className={`onboarding-step ${isDone ? "onboarding-step--done" : isCurrent ? "onboarding-step--current" : ""}`}><div className="flex items-start gap-3"><span className="onboarding-step__number">{isDone ? "✓" : String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium text-slate-100">{step.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{step.description}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="secondary-button !min-h-9 !px-3 !py-1.5 text-xs" onClick={() => onNavigate(step.section)}>{step.id === "answer" ? "Open Ask" : step.section === "overview" ? "View overview" : `Open ${step.section}`}</button>{!isDone && <button type="button" className="text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => markDone(step.id)}>Mark complete</button>}</div></div></div></article>; })}</div><aside className="rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4"><p className="text-sm font-medium text-cyan-100">Choose a starting path</p><p className="mt-2 text-xs leading-5 text-slate-400">Lumora will keep the guide practical for your team. Your choice only shapes the examples and suggestions.</p><div className="mt-4 grid grid-cols-3 gap-2">{[["legal", "Legal"], ["it", "IT"], ["custom", "Other"]].map(([value, label]) => <button key={value} type="button" className={`rounded-lg border px-2 py-2 text-xs transition ${goal === value ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100" : "border-slate-800 bg-slate-950/45 text-slate-400 hover:border-slate-700"}`} onClick={() => { setGoal(value); persist(value, completed); }}>{label}</button>)}</div>{goal === "legal" || !goal ? <><p className="mt-5 text-sm font-medium text-cyan-100">Legal workspace tip</p><p className="mt-2 text-xs leading-5 text-slate-400">Start with internal policies, playbooks, and approved templates. Keep sensitive matter details in the right workspace and ask focused questions.</p><div className="mt-4 space-y-2 text-xs text-slate-500"><p>Suggested question</p><p className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-slate-300">“What is our approved process for reviewing a new matter?”</p></div></> : <p className="mt-5 text-xs leading-5 text-slate-400">You can change this path later. The next best action is to add a trusted source to the workspace.</p>}<button type="button" className="mt-4 text-xs font-medium text-cyan-300 hover:text-cyan-100" onClick={() => { const selectedGoal = goal || "legal"; const next = completed.includes("purpose") ? completed : [...completed, "purpose"]; setGoal(selectedGoal); setCompleted(next); persist(selectedGoal, next); }}>Save starting path</button></aside></div>}
  </section>;
}
