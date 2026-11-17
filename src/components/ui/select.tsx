"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { getDirection } from "@/lib/i18n/utils";
import { cn } from "@/lib/utils";
import type { SelectProps } from "./select-types";

// Radix does not allow an empty-string item value (it means "no selection"), but <option value="">
// is common for "None" / "Choose…" rows, so those rows use this stand-in internally.
const EMPTY_VALUE = "__select_empty__";

type ParsedOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
  lang?: string;
};

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

// Reads <option> children (also inside fragments, arrays and conditionals) so call sites keep the native API.
function parseOptions(children: React.ReactNode): ParsedOption[] {
  const options: ParsedOption[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{
      value?: string | number;
      disabled?: boolean;
      lang?: string;
      children?: React.ReactNode;
    }>(child)) return;
    if (child.type === React.Fragment || child.type === "optgroup") {
      options.push(...parseOptions(child.props.children));
      return;
    }
    if (child.type !== "option") return;
    options.push({
      value: String(child.props.value ?? textOf(child.props.children)),
      label: child.props.children,
      disabled: child.props.disabled,
      lang: child.props.lang,
    });
  });
  return options;
}

// Kept on Radix Select: call sites style the trigger (className), its frame (containerClassName, often
// "contents") and hold a ref to the trigger button, while Orange's Select is a native <select> whose
// className lands on an outer field wrapper. Restyled as Orange's control and picker: 1px control frame
// with the accent border on focus, raised list with the overlay shadow and the accent bar on the active
// option, checked option marked in the accent text colour.
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className,
      containerClassName,
      children,
      value,
      defaultValue,
      onChange,
      placeholder,
      disabled,
      required,
      name,
      id,
      lang,
      form,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
    },
    ref,
  ) => {
    const options = parseOptions(children);
    const hasEmptyOption = options.some((option) => option.value === "");
    const toInternal = (raw: string) => (raw === "" && hasEmptyOption ? EMPTY_VALUE : raw);
    const [uncontrolled, setUncontrolled] = React.useState(String(defaultValue ?? ""));
    const current = value === undefined ? uncontrolled : String(value);
    // Call sites size the trigger (h-9, h-10…) as if it were the whole control, so while the frame draws its
    // 1px border the trigger reaches into it: the control keeps the height it was given, and the open list,
    // sized from the trigger, is exactly as wide as the frame.
    const framed = !/(^|\s)(contents|border-0)(\s|$)/.test(containerClassName ?? "");
    // Radix positions the list and reads arrow keys from `dir`; it defaults to ltr instead of the document's.
    const dir = getDirection(useLanguage().locale);

    function handleValueChange(next: string) {
      const raw = next === EMPTY_VALUE ? "" : next;
      if (value === undefined) setUncontrolled(raw);
      onChange?.({ target: { value: raw, name }, currentTarget: { value: raw, name } });
    }

    return (
      <span
        className={cn(
          "relative inline-flex border border-line-control bg-surface text-fg transition-[border-color,box-shadow,background-color] duration-150 ease-out hover:border-fg-subtle focus-within:border-accent has-[button:disabled]:border-line has-[button:disabled]:bg-canvas-subtle",
          containerClassName,
        )}
      >
        <SelectPrimitive.Root
          value={toInternal(current)}
          onValueChange={handleValueChange}
          disabled={disabled}
          dir={dir}
        >
          <SelectPrimitive.Trigger
            ref={ref}
            id={id}
            lang={lang}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            className={cn(
              "group flex w-full min-w-0 items-center justify-between gap-2 bg-transparent px-2 text-start outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-fg-disabled data-[placeholder]:text-fg-subtle",
              framed && "-m-px w-[calc(100%+2px)]",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              <SelectPrimitive.Value placeholder={placeholder} />
            </span>
            <SelectPrimitive.Icon asChild>
              <ChevronDown
                aria-hidden="true"
                size={16}
                className="shrink-0 text-fg-muted transition-transform duration-200 group-hover:text-fg group-data-[state=open]:rotate-180 motion-reduce:transition-none"
              />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>
          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              align="end"
              sideOffset={4}
              collisionPadding={8}
              className="z-[300] max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden border border-line-strong bg-surface-raised text-sm text-fg shadow-[var(--or-shadow-overlay)]"
            >
              <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto py-1">
                {options.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={toInternal(option.value)}
                    disabled={option.disabled}
                    lang={option.lang}
                    className="relative flex cursor-pointer select-none items-center py-2 pe-8 ps-3 outline-none before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled data-[highlighted]:bg-surface-hover data-[highlighted]:before:scale-y-100 data-[state=checked]:font-medium motion-reduce:before:transition-none"
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="absolute end-2 inline-flex text-accent-text">
                      <Check size={16} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>
        {(name || required) && (
          // Radix renders no form control of its own; this one carries the name/value into FormData
          // and makes `required` block submit while nothing is chosen.
          <input
            tabIndex={-1}
            aria-hidden="true"
            name={name}
            form={form}
            required={required}
            value={current}
            onChange={() => {}}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />
        )}
      </span>
    );
  },
);
Select.displayName = "Select";
