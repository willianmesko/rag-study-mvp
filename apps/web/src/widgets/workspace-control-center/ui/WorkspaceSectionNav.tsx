import type { Workspace } from "../../../shared/api/rag-api";
import { canAccessWorkspaceSection, type WorkspaceSection } from "../../../shared/lib/app-route";
import { useLocale } from "../../../shared/i18n/locale";

export function WorkspaceSectionNav({ activeSection, role, onChange }: { activeSection: WorkspaceSection; role: Workspace["role"]; onChange: (section: WorkspaceSection) => void }) {
  const { t } = useLocale();
  const sections: Array<{ id: WorkspaceSection; label: string }> = [
    { id: "overview", label: t("Overview", "Visão geral") },
    { id: "knowledge", label: t("Documents", "Documentos") },
    { id: "processing", label: t("Processing", "Processamento") },
    { id: "team", label: t("Team", "Equipe") },
    { id: "evaluations", label: t("Evaluations", "Avaliações") },
    { id: "settings", label: t("Settings", "Configurações") }
  ];

  return (
    <nav className="workspace-section-nav" aria-label={t("Workspace sections", "Seções do espaço de trabalho")}>
      {sections.filter((section) => canAccessWorkspaceSection(section.id, role)).map((section) => (
          <button key={section.id} type="button"
            className={`workspace-section-nav__item ${activeSection === section.id ? "workspace-section-nav__item--active" : ""}`}
            onClick={() => onChange(section.id)} aria-current={activeSection === section.id ? "page" : undefined}>
            {section.label}
          </button>
      ))}
    </nav>
  );
}
