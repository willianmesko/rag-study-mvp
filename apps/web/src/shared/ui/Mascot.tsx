import { brand } from "../config/brand";
import { useLocale } from "../i18n/locale";

export function Mascot({ size = "md", className = "", decorative = false }: { size?: "sm" | "md" | "lg"; className?: string; decorative?: boolean }) {
  const { t } = useLocale();
  return <img className={`lumora-mascot lumora-mascot--${size} ${className}`} src="/brand/lumora-milo.png" alt={decorative ? "" : t(brand.mascotAlt, "Milo, o assistente do Lumora")} />;
}
