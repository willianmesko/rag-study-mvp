import { brand } from "../config/brand";
import { useLocale } from "../i18n/locale";

export function Mascot({ size = "md", className = "", decorative = false, onLoad }: {
  size?: "sm" | "md" | "lg";
  className?: string;
  decorative?: boolean;
  onLoad?: () => void;
}) {
  const { t } = useLocale();
  return <img className={`lumora-mascot lumora-mascot--${size} ${className}`} src="/brand/lumora-milo.png"
    alt={decorative ? "" : t(brand.mascotAlt, "Milo, o assistente do Lumora")} onLoad={onLoad} />;
}
