"use client";

import { Skeleton as OrangeSkeleton } from "@orangesys/ui";
import type * as React from "react";
import { cn } from "@/lib/utils";
import type { SkeletonProps, SkeletonRowsProps } from "./skeleton-types";

// Orange's Skeleton (decorative, aria-hidden, shimmer that stops under reduced motion). The `rect` shape
// adds no margins, and call sites size every block with className, which wins over Orange's defaults.
export function Skeleton({ className, ...props }: SkeletonProps) {
	return <OrangeSkeleton variant="rect" className={className} {...(props as React.HTMLAttributes<HTMLSpanElement>)} />;
}

export function SkeletonRows({
	count = 5,
	compact = false,
}: SkeletonRowsProps) {
	return (
		<div className="divide-y divide-line-subtle">
			{Array.from({ length: count }, (_, index) => (
				<div
					key={index}
					className={cn(
						"flex items-center gap-3",
						compact ? "px-4 py-3" : "px-6 py-4",
					)}
				>
					<Skeleton className="h-4 w-4 shrink-0" />
					<Skeleton className={cn("shrink-0", compact ? "h-9 w-9 rounded-full" : "h-5 w-36")} />
					<div className="min-w-0 flex-1 space-y-2">
						<Skeleton className="h-3.5 w-2/3" />
						{compact && <Skeleton className="h-3 w-5/6" />}
					</div>
					<Skeleton className="h-3 w-12 shrink-0" />
				</div>
			))}
		</div>
	);
}
