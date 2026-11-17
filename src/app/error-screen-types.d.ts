import type { ReactNode } from "react";

/** Props vinext and Next hand to an `error.tsx` boundary. vinext passes `reset`; Next 16.3+ also passes `retry`. */
export type RouteErrorProps = {
	error: unknown;
	retry?: () => void;
	reset?: () => void;
};

export type ErrorScreenProps = {
	icon: ReactNode;
	title: string;
	description: string;
	/** Server error identifier, shown so it can be matched against the logs. */
	digest?: string | null;
	/** Fill the viewport (root boundaries) instead of the content area of a layout. */
	fullPage?: boolean;
	children?: ReactNode;
};
