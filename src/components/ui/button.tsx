"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import type { ButtonProps } from "./button-types";
import { buttonVariants } from "./button-utils";

export type { ButtonProps, ButtonSize, ButtonVariant } from "./button-types";

// Orange's look through its public `buttonClassName()`, on a plain <button> (or the `asChild` element).
// Orange's own <Button> is not used: it wraps children in a label span (breaking the icon + text and
// justify-* layouts call sites build), defaults `type` to "button" (call sites rely on the native
// submit default inside forms) and has no `asChild`.
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button";
		return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
	},
);
Button.displayName = "Button";
