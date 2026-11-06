import { navigateTo, type WorkspaceSection } from "../../../shared/lib/app-route";
import { WorkspaceSectionNav } from "./WorkspaceSectionNav";
import { AdminPanel } from "../../admin-corpus/ui/AdminPanel";

export function WorkspaceControlCenter({ section, role, selectedWorkspaceId, onWorkspaceChange, onSectionChange }: { section: WorkspaceSection; role?: "owner" | "editor" | "viewer"; selectedWorkspaceId?: string; onWorkspaceChange: (workspaceId: string) => void; onSectionChange: (section: WorkspaceSection) => void }) {
  return <section className="space-y-6">
    <div className="workspace-control-center__heading"><div><p className="eyebrow">Workspace control center</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Make your knowledge work for the team.</h2><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Organize sources, follow processing, manage access, and keep answer quality visible without needing to understand the infrastructure underneath.</p></div><span className="status-pill">Admin workspace</span></div>
    <WorkspaceSectionNav activeSection={section} role={role} onChange={onSectionChange} />
    <AdminPanel section={section} selectedWorkspaceId={selectedWorkspaceId} onWorkspaceChange={onWorkspaceChange} onSectionChange={onSectionChange} onNavigateToAsk={() => navigateTo("/ask")} />
  </section>;
}
