import * as React from "react";
import { cn } from "@/lib/utils";

// Kept as Mailclaw's own composition (Card > CardHeader > CardTitle…, each with its own className):
// Orange's CardHeader takes `title`/`description` props instead of children, and Orange's Card is a
// padded, bordered box where this one is a section ruled off by a top line. Restyled with Orange's
// tokens: 1px rules, Space Grotesk titles, muted descriptions.
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("border-t border-line text-fg", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("flex flex-col gap-1.5 py-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h3
			className={cn("font-display text-lg font-semibold leading-tight tracking-[-0.01em] text-fg", className)}
			{...props}
		/>
	);
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
	return <p className={cn("text-sm text-fg-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("pb-0", className)} {...props} />;
}
