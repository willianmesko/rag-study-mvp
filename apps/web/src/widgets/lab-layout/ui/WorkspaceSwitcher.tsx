import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useRef, useState } from "react";
import { WorkspaceCreationForm } from "../../../features/workspace-creation/ui/WorkspaceCreationForm";
import type { Workspace } from "../../../shared/api/rag-api";
import { useLocale } from "../../../shared/i18n/locale";

export type WorkspaceCreation = { accessToken: string; onWorkspaceCreated: (workspace: Workspace) => void };

export function WorkspaceSwitcher({ workspaces, selectedId, onChange, creation, compact = false }: {
  workspaces: Workspace[];
  selectedId: string;
  onChange: (workspaceId: string) => void;
  creation?: WorkspaceCreation;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [creating, setCreating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingCreation = useRef(false);
  if (workspaces.length === 0) return null;
  const roles = { owner: t("Owner", "Proprietário"), editor: t("Editor", "Editor"), viewer: t("Viewer", "Leitor") };
  const selected = workspaces.find((workspace) => workspace.tenantId === selectedId) ?? workspaces[0];

  return (
    <div className="w-full min-w-0">
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button ref={trigger} type="button"
            aria-label={t(`Workspace: ${selected.tenantName}, ${roles[selected.role]}`, `Espaço de trabalho: ${selected.tenantName}, ${roles[selected.role]}`)}
            className={`group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-xl border border-slate-700/90 bg-slate-900/70 text-left transition-colors hover:border-slate-500 hover:bg-slate-800/80 data-[state=open]:border-cyan-300/50 data-[state=open]:bg-slate-800/80 ${compact ? "px-3 py-2" : "p-3"}`}>
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan-400/10 text-cyan-200 ring-1 ring-inset ring-cyan-300/20">
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M4 10h16m-10 0v10" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-100" title={selected.tenantName}>{selected.tenantName}</span>{" "}
              <span className="mt-0.5 block text-xs text-slate-400">{roles[selected.role]}</span>
            </span>
            <svg aria-hidden="true" className="size-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={8} collisionPadding={12}
            className="z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-72 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-1.5 text-slate-100 shadow-2xl shadow-black/40"
            onCloseAutoFocus={(event) => {
              if (pendingCreation.current) {
                event.preventDefault();
                pendingCreation.current = false;
                setCreating(true);
              }
            }}>
            <DropdownMenu.Label className="px-3 py-2 text-xs font-semibold text-slate-400">{t("Your workspaces", "Seus espaços de trabalho")}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={selected.tenantId} onValueChange={(workspaceId) => {
              if (workspaceId !== selected.tenantId) onChange(workspaceId);
            }}>
              {workspaces.map((workspace) => (
                <DropdownMenu.RadioItem key={workspace.tenantId} value={workspace.tenantId} textValue={workspace.tenantName}
                  className="relative flex min-h-14 cursor-pointer select-none items-center rounded-xl py-2.5 pl-3 pr-10 outline-none data-[highlighted]:bg-slate-800 data-[state=checked]:bg-cyan-400/10 data-[highlighted]:text-white">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" title={workspace.tenantName}>{workspace.tenantName}</span>
                    <span className="mt-0.5 block text-xs text-slate-400">{roles[workspace.role]}</span>
                  </span>
                  <DropdownMenu.ItemIndicator className="absolute right-3 text-cyan-200">
                    <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8 3 3 6-6" /></svg>
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            {creation && <>
              <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-slate-800" />
              <DropdownMenu.Item className="flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-cyan-100 outline-none data-[highlighted]:bg-slate-800"
                aria-haspopup="dialog" onSelect={() => { pendingCreation.current = true; }}>
                <span aria-hidden="true" className="text-lg leading-none">+</span>
                {t("New workspace", "Novo espaço")}
              </DropdownMenu.Item>
            </>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {creating && creation && <WorkspaceCreationForm {...creation} onDismiss={() => {
        setCreating(false);
        trigger.current?.focus();
      }} />}
    </div>
  );
}
