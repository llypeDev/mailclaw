import type { useRouter } from "next/navigation";
import { claimRouteTemplatePrefetch, getRouteTemplateKey } from "./prefetch-utils";

type PrefetchOptions = Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];
type AppRouter = ReturnType<typeof useRouter>;

/** `kind: "full"` is an enum in Next's types but a string at runtime. */
export const FULL_ROUTE_PREFETCH = { kind: "full" } as PrefetchOptions;

const routeTemplatePrefetches = new Map<string, number>();

/**
 * Prefetches one message route per folder instead of one per hovered row. The
 * detail page is a client component that reads the message itself, so every
 * message's route payload is the same; the router reuses the first one as a
 * template for its siblings.
 */
export function prefetchRouteTemplate(router: AppRouter, href: string): void {
	if (!claimRouteTemplatePrefetch(routeTemplatePrefetches, getRouteTemplateKey(href), Date.now())) return;
	// A dynamic route only gets a shell from automatic prefetch.
	router.prefetch(href, FULL_ROUTE_PREFETCH);
}
