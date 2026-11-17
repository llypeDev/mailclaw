"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/components/icons";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";
import { buttonVariants } from "./button-utils";

// Kept on Radix: call sites compose Dialog / DialogTrigger asChild / DialogContent / DialogTitle /
// DialogClose and pass Radix props (onEscapeKeyDown, onInteractOutside), which Orange's Modal (title as
// a prop, its own trigger) cannot take. Radix also stacks these with the Radix menus and selects used
// inside them. Restyled as Orange's modal: overlay token, raised surface with the overlay shadow,
// square corners, Space Grotesk title and a ghost icon button to close. Content scrolls when tall.
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
	className,
	children,
	closeLabel,
	overlayClassName,
	closeClassName,
	showCloseButton = true,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string; overlayClassName?: string; closeClassName?: string; showCloseButton?: boolean }) {
	const { t } = useLanguage();
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className={cn("dialog-overlay fixed inset-0 z-50 bg-overlay", overlayClassName)} />
			<DialogPrimitive.Content
				className={cn(
					"dialog-content fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-surface-raised p-6 text-fg shadow-[var(--or-shadow-overlay)] outline-none forced-colors:border",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						className={cn(buttonVariants({ variant: "ghost", size: "roundedSM" }), "absolute right-3 top-3", closeClassName)}
					>
						<X className="h-4 w-4" aria-hidden="true" />
						<span className="sr-only">{closeLabel ?? t("navigation.close")}</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("mb-5 space-y-2 pr-8", className)} {...props} />;
}

export function DialogTitle({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			className={cn(
				"font-display text-[length:var(--or-text-xl)] font-bold leading-[var(--or-leading-heading)] tracking-[-0.02em] text-fg [overflow-wrap:anywhere]",
				className,
			)}
			{...props}
		/>
	);
}

export function DialogDescription({
	className,
	...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-sm leading-[var(--or-leading-body)] text-fg-muted", className)} {...props} />;
}
