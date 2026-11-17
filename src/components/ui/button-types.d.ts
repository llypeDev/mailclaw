import type * as React from "react";

/** `default` is Orange's primary, `destructive` its danger; the others keep Orange's names. */
export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";

/** `default`, `sm` and `lg` are Orange's md/sm/lg; `icon` and `roundedSM` are square icon-only buttons. */
export type ButtonSize = "default" | "sm" | "lg" | "roundedSM" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant | null;
	size?: ButtonSize | null;
	/** Renders the single child (a link, usually) with the button's classes instead of a <button>. */
	asChild?: boolean;
}
