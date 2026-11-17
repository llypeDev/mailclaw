import type * as React from "react";

export type BadgeVariant = "default" | "secondary" | "outline" | "success";

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
	variant?: BadgeVariant | null;
};
