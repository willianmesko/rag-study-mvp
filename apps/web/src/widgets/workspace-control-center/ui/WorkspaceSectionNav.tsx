import type { WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";

export function WorkspaceSectionNav({ activeSection, role, onChange }: { activeSection: WorkspaceSection; role?: "owner" | "editor" | "viewer"; onChange: (section: WorkspaceSection) => void }) {
  const { t } = useLocale();
  const canManage = role === "owner";
  const sections: Array<{ id: WorkspaceSection; label: string; description: string; icon: string; ownerOnly?: boolean }> = [
    { id: "overview", label: t("Overview", "Visão geral"), description: t("Workspace summary", "Resumo do espaço"), icon: "◌" },
    { id: "knowledge", label: t("Knowledge", "Documentos"), description: t("Documents and chunks", "Documentos e trechos"), icon: "⌁" },
    { id: "processing", label: t("Processing", "Processamento"), description: t("Ingestion jobs", "Status dos arquivos"), icon: "↗" },
    { id: "team", label: t("Team", "Equipe"), description: t("Members and access", "Membros e acessos"), icon: "◎", ownerOnly: true },
    { id: "evaluations", label: t("Evaluations", "Avaliações"), description: t("Quality and safety", "Qualidade e segurança"), icon: "✦", ownerOnly: true },
    { id: "settings", label: t("Settings", "Configurações"), description: t("Workspace policies", "Políticas do espaço"), icon: "⚙", ownerOnly: true }
  ];

  return (
    <nav className="workspace-section-nav" aria-label={t("Workspace sections", "Seções do espaço de trabalho")}>
      {sections.map((section) => {
        const restricted = Boolean(section.ownerOnly && !canManage);
        return (
          <button key={section.id} type="button" disabled={restricted}
            className={`workspace-section-nav__item ${activeSection === section.id ? "workspace-section-nav__item--active" : ""} ${restricted ? "workspace-section-nav__item--restricted" : ""}`}
            onClick={() => onChange(section.id)} aria-current={activeSection === section.id ? "page" : undefined}>
            <span className="workspace-section-nav__icon" aria-hidden="true">{section.icon}</span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-medium">{section.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-slate-500">{restricted ? t("Owner access", "Acesso de proprietário") : section.description}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
