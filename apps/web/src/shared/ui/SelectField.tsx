import * as Select from "@radix-ui/react-select";
import { useId, useLayoutEffect, useRef, useState } from "react";

type SelectOption = {
  value: string;
  label: string;
  description?: string;
  lang?: string;
};

type SelectFieldProps = {
  label: string;
  hideLabel?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  className?: string;
};

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden="true" className={`select-field__chevron ${up ? "rotate-180" : ""}`} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function SelectField({ label, hideLabel, value, onValueChange, options, disabled, className = "" }: SelectFieldProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement>();
  useLayoutEffect(() => { setPortalContainer(trigger.current?.closest("dialog") ?? undefined); }, []);
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`select-field ${className}`}>
      <label htmlFor={id} id={`${id}-label`} className={hideLabel ? "sr-only" : "select-field__label"}>{label}</label>
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger ref={trigger} id={id} aria-labelledby={`${id}-label`} className="select-field__trigger">
          <span className="select-field__value" title={selected?.label}>
            <Select.Value><span lang={selected?.lang}>{selected?.label ?? label}</span></Select.Value>
          </span>
          <Select.Icon asChild><Chevron /></Select.Icon>
        </Select.Trigger>
        <Select.Portal container={portalContainer}>
          <Select.Content position="popper" align="start" sideOffset={6} collisionPadding={12}
            aria-labelledby={`${id}-label`} className="select-field__menu">
            <Select.ScrollUpButton className="select-field__scroll"><Chevron up /></Select.ScrollUpButton>
            <Select.Viewport className="select-field__viewport">
              {options.map((option, index) => (
                <Select.Item key={option.value} value={option.value} textValue={option.label}
                  aria-describedby={option.description ? `${id}-option-${index}` : undefined} className="select-field__option">
                  <span className="min-w-0">
                    <Select.ItemText><span lang={option.lang}>{option.label}</span></Select.ItemText>
                    {option.description && <span id={`${id}-option-${index}`} className="select-field__description">{option.description}</span>}
                  </span>
                  <Select.ItemIndicator className="select-field__indicator">
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75"
                      strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8 3 3 6-6" /></svg>
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-field__scroll"><Chevron /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
