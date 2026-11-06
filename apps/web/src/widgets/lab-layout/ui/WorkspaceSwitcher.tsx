import type { Workspace } from "../../../shared/api/rag-api";

export function WorkspaceSwitcher({ workspaces, selectedId, onChange }: { workspaces: Workspace[]; selectedId: string; onChange: (workspaceId: string) => void }) {
  if (workspaces.length === 0) return null;
  return <label className="workspace-switcher"><span className="workspace-switcher__label">Workspace</span><select aria-label="Select workspace" value={selectedId} onChange={(event) => onChange(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.tenantId} value={workspace.tenantId}>{workspace.tenantName} · {workspace.role}</option>)}</select></label>;
}
