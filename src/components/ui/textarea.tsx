import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClassName } from "./control-utils";

// Kept as a bare <textarea> for the same reason as Input (Orange's TextArea brings its own label and
// wrapper). Restyled to Orange's control; it resizes vertically only, like Orange's.
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
	({ className, ...props }, ref) => (
		<textarea
			className={cn("flex min-h-[80px] resize-y py-2 leading-[var(--or-leading-body)]", controlClassName, className)}
			ref={ref}
			{...props}
		/>
	),
);
Textarea.displayName = "Textarea";
