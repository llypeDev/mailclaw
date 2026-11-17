"use client";

import { RouteErrorFallback } from "./error-screen";
import type { RouteErrorProps } from "./error-screen-types";

export default function RootError(props: RouteErrorProps) {
	return <RouteErrorFallback {...props} fullPage />;
}
