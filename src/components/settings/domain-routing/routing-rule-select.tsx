import * as React from "react";
import { Select } from "@/components/ui/select";
import type { SelectProps } from "@/components/ui/select-types";
import { cn } from "@/lib/utils";

export const RoutingRuleSelect = React.forwardRef<HTMLButtonElement, SelectProps>(
	({ className, containerClassName, ...props }, ref) => (
		<Select
			ref={ref}
			containerClassName={cn("block min-w-0 border-0 px-0", containerClassName)}
			className={cn(
				"h-10 border border-line-control bg-surface py-2 ps-3 pe-3 text-sm transition-colors hover:border-fg-subtle focus-visible:border-accent",
				className,
			)}
			{...props}
		/>
	),
);
RoutingRuleSelect.displayName = "RoutingRuleSelect";
