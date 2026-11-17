import * as React from "react";
import { cn } from "@/lib/utils";
import { controlClassName } from "./control-utils";

// Kept as a bare <input>: call sites label it with their own <Label htmlFor>, while Orange's TextField
// renders its own label and field wrapper around the input. Restyled to Orange's control.
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
	({ className, type, ...props }, ref) => (
		<input
			type={type}
			className={cn(
				"flex h-10 py-2",
				controlClassName,
				"file:mr-3 file:border-0 file:bg-transparent file:font-display file:text-sm file:font-semibold file:text-fg",
				className,
			)}
			ref={ref}
			{...props}
		/>
	),
);
Input.displayName = "Input";
