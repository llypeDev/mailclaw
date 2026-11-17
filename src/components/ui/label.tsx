import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

// Kept on Radix's label (call sites pair it with their own controls through htmlFor). Orange's field
// label look: Space Grotesk, semibold, full-contrast text.
export const Label = React.forwardRef<
	React.ElementRef<typeof LabelPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
	<LabelPrimitive.Root
		ref={ref}
		className={cn(
			"font-display text-sm font-semibold leading-none tracking-[-0.005em] text-fg peer-disabled:cursor-not-allowed peer-disabled:text-fg-disabled",
			className,
		)}
		{...props}
	/>
));
Label.displayName = LabelPrimitive.Root.displayName;
