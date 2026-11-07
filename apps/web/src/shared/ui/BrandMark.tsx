export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <span aria-hidden="true" className={`brand-mark ${compact ? "brand-mark--compact" : ""}`}>
    <img src="/brand/lumora-mark.svg?v=2" alt="" width="48" height="48" draggable={false} />
  </span>;
}
