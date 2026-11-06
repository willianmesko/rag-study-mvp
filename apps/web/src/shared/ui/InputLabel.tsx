import type { ReactNode } from "react";

export function InputLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium text-slate-300">{label}{children}</label>;
}
