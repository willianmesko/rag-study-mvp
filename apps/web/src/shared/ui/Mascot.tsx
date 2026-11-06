import { brand } from "../config/brand";

export function Mascot({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return <img className={`lumora-mascot lumora-mascot--${size} ${className}`} src="/brand/lumora-milo.png" alt={brand.mascotAlt} />;
}
