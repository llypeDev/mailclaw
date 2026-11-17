import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

// Kept: these are rows of records with actions (`ListRow asChild` turns a row into a link), not
// Orange's List, which is a typographic <ul> of bullet/numbered text. Restyled to Orange's explicit
// grid: rows on the surface, separated by 1px rules inside a 1px frame.
export function List({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("grid gap-px border border-line bg-line", className)} {...props} />;
}

export interface ListRowProps extends React.HTMLAttributes<HTMLElement> {
	asChild?: boolean;
}

export function ListRow({ className, asChild = false, ...props }: ListRowProps) {
	const Comp: React.ElementType = asChild ? Slot : "div";
	return <Comp className={cn("flex items-center gap-4 bg-surface p-5 text-fg", className)} {...props} />;
}
