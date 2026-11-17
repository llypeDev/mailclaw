"use client";

import { Switch as OrangeSwitch } from "@orangesys/ui";
import { cn } from "@/lib/utils";
import type { SwitchProps } from "./switch-types";

// Orange's Switch, always controlled here. `id`, `aria-*` and the other button props reach the
// <button role="switch">, so `<Label htmlFor>` and `aria-label` keep naming it; Orange puts `className`
// on its wrapper, made `inline-flex` so it sits in the flow like the bare button it replaces.
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
	return (
		<OrangeSwitch
			checked={checked}
			onCheckedChange={onCheckedChange}
			className={cn("inline-flex shrink-0", className)}
			{...props}
		/>
	);
}
