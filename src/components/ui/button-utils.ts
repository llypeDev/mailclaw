import { buttonClassName } from "@orangesys/ui";
import type { ButtonSize, ButtonVariant } from "./button-types";

// Mailclaw's variant names, mapped onto Orange's. `default` is the one primary action of a context.
const VARIANTS: Record<ButtonVariant, "primary" | "secondary" | "outline" | "ghost" | "danger"> = {
	default: "primary",
	secondary: "secondary",
	outline: "outline",
	ghost: "ghost",
	destructive: "danger",
};

// Orange sizes the button with `min-height`, which would stop the `h-7`/`h-8` overrides many call sites
// pass. `min-h-0` plus a Tailwind height keeps Orange's 32/40/48px scale while a className can still win.
const SIZES: Record<ButtonSize, { size: "sm" | "md" | "lg"; iconOnly: boolean; height: string }> = {
	default: { size: "md", iconOnly: false, height: "h-10" },
	sm: { size: "sm", iconOnly: false, height: "h-8" },
	lg: { size: "lg", iconOnly: false, height: "h-12" },
	// Square icon buttons. The old names are kept so call sites do not change.
	roundedSM: { size: "sm", iconOnly: true, height: "h-8" },
	icon: { size: "md", iconOnly: true, height: "h-10" },
};

/** Orange's button classes for a Mailclaw variant and size, plus the height hook described above. */
export function buttonVariants({ variant, size }: { variant?: ButtonVariant | null; size?: ButtonSize | null } = {}): string {
	const resolved = SIZES[size ?? "default"];
	return `${buttonClassName({ variant: VARIANTS[variant ?? "default"], size: resolved.size, iconOnly: resolved.iconOnly })} min-h-0 ${resolved.height}`;
}
