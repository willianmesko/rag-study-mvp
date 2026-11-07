import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useLayoutEffect, useRef, useState } from "react";

type MenuAction = { label: string; onSelect: () => void; disabled?: boolean; destructive?: boolean };

export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  useLayoutEffect(() => { setPortalContainer(trigger.current?.closest("dialog") ?? undefined); }, []);
  const pendingAction = useRef<(() => void) | null>(null);

  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>
      <button ref={trigger} className="secondary-button min-w-11 shrink-0 px-3" type="button" aria-label={label}>
        <svg aria-hidden="true" className="size-4" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" /></svg>
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal container={portalContainer}>
      <DropdownMenu.Content align="end" sideOffset={6} collisionPadding={12}
        className="z-50 w-56 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-700 bg-slate-950 p-1.5 text-sm text-slate-100 shadow-xl"
        onCloseAutoFocus={(event) => {
          const action = pendingAction.current;
          pendingAction.current = null;
          if (action) {
            event.preventDefault();
            trigger.current?.focus({ preventScroll: true });
            action();
          }
        }}>
        {actions.map((action) => <DropdownMenu.Item key={action.label} disabled={action.disabled}
          onSelect={() => { pendingAction.current = action.onSelect; }}
          className={`menu-action ${action.destructive ? "text-rose-200" : "text-slate-100"}`}>
          {action.label}
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
