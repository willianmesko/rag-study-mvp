import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useLocale } from "../i18n/locale";

export function Overlay({ title, description, children, onClose, side = false, pending = false, initialFocusRef }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  side?: boolean;
  pending?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    initialFocusRef?.current?.focus({ preventScroll: true });
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [initialFocusRef]);

  return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!pending) onClose(); }}
    className={`fixed overflow-y-auto border-slate-800 bg-slate-950 p-0 text-slate-100 shadow-2xl shadow-black/40 backdrop:bg-slate-950/70 ${side
      ? "inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-2xl border-l"
      : "inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-2xl rounded-2xl border"}`}>
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950 px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 id={titleId} className="break-words text-lg font-semibold text-white">{title}</h2>
        {description && <p id={descriptionId} className="mt-1 break-words text-sm text-slate-400">{description}</p>}
      </div>
      <button className="secondary-button min-w-11 shrink-0 px-3" type="button" onClick={onClose} disabled={pending} aria-label={t("Close", "Fechar")}>
        <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m4 4 8 8m0-8-8 8" /></svg>
      </button>
    </div>
    <div className="space-y-5 p-5 sm:p-6">{children}</div>
  </dialog>;
}
