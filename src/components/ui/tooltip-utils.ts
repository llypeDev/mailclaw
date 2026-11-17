import type { TooltipProps } from "./tooltip-types";

/** Mailclaw's placements in Orange's terms: `auto` prefers below and flips above, `right` flips left. */
export function getTooltipPlacement(placement: TooltipProps["placement"] = "auto"): "bottom" | "right" {
	return placement === "right" ? "right" : "bottom";
}

/** Whether focus arrived from the keyboard (`:focus-visible`), the only focus that should open a tooltip. */
export function isKeyboardFocus(element: Element): boolean {
	try {
		return element.matches(":focus-visible");
	} catch {
		// Engines without :focus-visible: treat every focus as keyboard focus, as the old tooltip did.
		return true;
	}
}
