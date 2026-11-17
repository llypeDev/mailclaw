"use client";

import { RouteErrorFallback } from "@/app/error-screen";
import type { RouteErrorProps } from "@/app/error-screen-types";

// Renders inside the group's layout, so the navigation stays usable.
export default function SectionError(props: RouteErrorProps) {
	return <RouteErrorFallback {...props} />;
}
