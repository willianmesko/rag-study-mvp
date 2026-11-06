import type { WorkspaceSection } from "../../../shared/lib/app-route";

const sections: Array<{ id: WorkspaceSection; label: string; description: string; icon: string }> = [
  { id: "overview", label: "Overview", description: "Workspace pulse", icon: "◌" },
  { id: "knowledge", label: "Knowledge", description: "Documents and chunks", icon: "⌁" },
  { id: "processing", label: "Processing", description: "Ingestion jobs", icon: "↗" },
  { id: "team", label: "Team", description: "Members and access", icon: "◎" },
  { id: "evaluations", label: "Evaluations", description: "Quality and safety", icon: "✦" },
  { id: "settings", label: "Settings", description: "Workspace policies", icon: "⚙" }
];

export function WorkspaceSectionNav({ activeSection, role, onChange }: { activeSection: WorkspaceSection; role?: "owner" | "editor" | "viewer"; onChange: (section: WorkspaceSection) => void }) {
  const canManage = role === "owner";
  return <nav className="workspace-section-nav" aria-label="Workspace sections">
    {sections.map((section) => {
      const restricted = (section.id === "team" || section.id === "evaluations" || section.id === "settings") && !canManage;
      return <button key={section.id} type="button" disabled={restricted} className={`workspace-section-nav__item ${activeSection === section.id ? "workspace-section-nav__item--active" : ""} ${restricted ? "workspace-section-nav__item--restricted" : ""}`} onClick={() => onChange(section.id)} aria-current={activeSection === section.id ? "page" : undefined} aria-disabled={restricted}>
        <span className="workspace-section-nav__icon" aria-hidden="true">{section.icon}</span>
        <span className="min-w-0 text-left"><span className="block text-sm font-medium">{section.label}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{restricted ? "Owner access" : section.description}</span></span>
      </button>;
    })}
  </nav>;
}
