import type { ReactNode, Ref } from "react";

export function WorkspacePageHeader({ title, description, children, headingRef }: {
  title: string;
  description?: string;
  children?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return <header className="flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
      {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>}
    </div>
    {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
  </header>;
}
