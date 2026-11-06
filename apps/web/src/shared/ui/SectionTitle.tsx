import type { ReactNode } from "react";

export function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="space-y-2"><p className="text-xs font-semibold tracking-[0.18em] text-cyan-300 uppercase">{eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h2><p className="max-w-2xl text-sm leading-6 text-slate-400">{children}</p></div>;
}
