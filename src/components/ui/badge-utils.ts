import * as React from "react";
import type { BadgeVariant } from "./badge-types";

type TagLook = { variant: "solid" | "outline"; tone: "neutral" | "success" };

const LOOKS: Record<BadgeVariant, TagLook> = {
	default: { variant: "solid", tone: "neutral" },
	secondary: { variant: "solid", tone: "neutral" },
	outline: { variant: "outline", tone: "neutral" },
	success: { variant: "solid", tone: "success" },
};

/** The Orange Tag variant and tone a Mailclaw badge variant maps to. */
export function badgeLook(variant: BadgeVariant | null | undefined): TagLook {
	return LOOKS[variant ?? "default"];
}

/**
 * Call sites write `<Badge><StatusIcon /> Label</Badge>`. Orange's Tag puts its children in a single text
 * span, so a leading icon component is lifted into the Tag's `icon` slot, where it gets the Tag's spacing
 * and tone. Intrinsic elements (`<strong>`, `<span>`) are text, not icons, and stay in place.
 */
export function splitLeadingIcon(children: React.ReactNode): { icon: React.ReactNode; label: React.ReactNode } {
	const items = React.Children.toArray(children);
	const [first, ...rest] = items;
	if (rest.length > 0 && React.isValidElement(first) && typeof first.type !== "string") return { icon: first, label: rest };
	return { icon: undefined, label: children };
}
