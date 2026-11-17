"use client";

import { Tag } from "@orangesys/ui";
import type * as React from "react";
import type { BadgeProps } from "./badge-types";
import { badgeLook, splitLeadingIcon } from "./badge-utils";

export type { BadgeProps, BadgeVariant } from "./badge-types";

/** A short status or category label: Orange's Tag, small and without the square marker. */
export function Badge({ className, variant, children, ...props }: BadgeProps) {
	const { variant: tagVariant, tone } = badgeLook(variant);
	const { icon, label } = splitLeadingIcon(children);
	return (
		<Tag
			size="sm"
			variant={tagVariant}
			tone={tone}
			marker={false}
			icon={icon}
			className={className}
			{...(props as React.HTMLAttributes<HTMLSpanElement>)}
		>
			{label}
		</Tag>
	);
}
