// Test-only browser entry. It is never imported by the application build.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { LocaleProvider } from "../../../apps/web/src/shared/i18n/locale";
import { Overlay } from "../../../apps/web/src/shared/ui/Overlay";
import { SelectField } from "../../../apps/web/src/shared/ui/SelectField";
import { ActionMenu } from "../../../apps/web/src/shared/ui/ActionMenu";
import { OriginalDocumentAction } from "../../../apps/web/src/features/open-original-document/index";
import { RagEvidencePanel } from "../../../apps/web/src/entities/source/index";

function Fixture() {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false);
  const [value, setValue] = useState("alpha"), [closed, setClosed] = useState(0), [actions, setActions] = useState(0);
  const [document, setDocument] = useState("document-a");
  useEffect(() => {
    const finish = () => setPending(false), change = () => setDocument("document-b");
    window.addEventListener("fixture-finished", finish);
    window.addEventListener("fixture-document", change);
    return () => { window.removeEventListener("fixture-finished", finish); window.removeEventListener("fixture-document", change); };
  }, []);
  const source = { chunkId: "fixture-chunk", documentId: "document-a", source: "handbook.md", title: "Handbook", chunk: 0, score: 0.875,
    excerpt: '<img src=x onerror="window.unsafePreview=true">', excerptTruncated: true };
  return <main style={{ padding: "1rem", maxWidth: "48rem" }}>
    <h1>Interaction fixture</h1>
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBlock: "1rem" }}>
      {(["primary", "secondary", "danger"] as const).map((variant) => <div key={variant}>
        <button className={`${variant}-button`} onClick={() => setActions((n) => n + 1)}>{variant} action</button>
        <button className={`${variant}-button`} disabled>{variant} disabled</button>
        <button className={`${variant}-button`} disabled aria-busy="true">{variant} pending</button>
      </div>)}
      <a className="text-action" href="#fixture">Text link</a>
    </div>
    <button className="secondary-button" onClick={() => setOpen(true)}>Open controls</button>
    {open && <Overlay title="Fixture controls" description="Choose an option, then close the window." pending={pending}
      onClose={() => { setOpen(false); setClosed((n) => n + 1); }}>
      <SelectField label="Fixture selection" value={value} onValueChange={setValue} disabled={pending} options={[
        { value: "alpha", label: "Alpha" }, { value: "blocked", label: "Unavailable", disabled: true }, { value: "gamma", label: "Gamma" },
      ]} />
      <ActionMenu label="Fixture actions" actions={[{ label: "Inspect", onSelect: () => setActions((n) => n + 1), disabled: pending },
        { label: "Unavailable action", onSelect: () => setActions((n) => n + 1), disabled: true }]} />
      <button className="primary-button" onClick={() => setPending(true)} disabled={pending} aria-busy={pending || undefined}>Start work</button>
    </Overlay>}
    <output aria-label="Closed count">{closed}</output>
    <output aria-label="Action count">{actions}</output>
    <OriginalDocumentAction documentId={document} documentName={document} accessToken="fixture-file-token" workspaceId="fixture-workspace" />
    <RagEvidencePanel response={{ answer: "Read the source.", sources: [source], citedChunkIds: [source.chunkId], contextSources: [source] }} citations={[source]} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<LocaleProvider><Fixture /></LocaleProvider>);
