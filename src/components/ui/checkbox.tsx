"use client";

import * as React from "react";
import { Checkbox as OrangeCheckbox } from "@orangesys/ui";
import { cn } from "@/lib/utils";
import type { CheckboxProps } from "./checkbox-types";

// Orange's Checkbox: the ref and native props (checked, onChange, disabled, aria-label…) reach the
// <input>, which keeps a 24px hit area over the drawn box. Orange puts `className` on its wrapper, so
// call-site spacing (`mt-1`, `ml-1`, `invisible`) still applies; `inline-flex` keeps the wrapper in the
// text flow like the bare input it replaces (centred in table cells, beside label text).
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
	<OrangeCheckbox ref={ref} className={cn("inline-flex shrink-0 align-middle", className)} {...props} />
));
Checkbox.displayName = "Checkbox";
