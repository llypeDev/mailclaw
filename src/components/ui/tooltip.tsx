"use client";

import { Tooltip as OrangeTooltip } from "@orangesys/ui";
import { useState } from "react";
import type { FocusEvent } from "react";
import { cn } from "@/lib/utils";
import type { TooltipProps } from "./tooltip-types";
import { getTooltipPlacement, isKeyboardFocus } from "./tooltip-utils";

// Orange's Tooltip (positioning, flip, delay, Escape, inverse surface). Call sites pass any children and
// a className for the wrapper, so the children stay inside the same inline-flex span, and that span is
// Orange's trigger. Orange opens on keyboard focus only when the trigger itself is :focus-visible, which
// a wrapper never is, so focus inside the span opens it here; pointer, blur, press and Escape stay Orange's.
export function Tooltip({ label, children, className, placement = "auto" }: TooltipProps) {
	const [open, setOpen] = useState(false);

	if (!label) return children;

	function handleFocus(event: FocusEvent<HTMLSpanElement>) {
		if (isKeyboardFocus(event.target)) setOpen(true);
	}

	return (
		<OrangeTooltip content={label} placement={getTooltipPlacement(placement)} open={open} onOpenChange={setOpen}>
			<span className={cn("inline-flex", className)} onFocus={handleFocus}>
				{children}
			</span>
		</OrangeTooltip>
	);
}
