/** Call only after session authentication. Bearer tokens are not sent automatically by browsers. */
export function hasValidSessionMutationOrigin(request: Request): boolean {
	if (request.headers.get("Authorization")?.startsWith("Bearer ")) return true;
	const fetchSite = request.headers.get("Sec-Fetch-Site");
	if (fetchSite === "same-origin") return true;
	if (fetchSite === "cross-site" || fetchSite === "same-site") return false;
	const origin = request.headers.get("Origin");
	return origin !== null && origin === new URL(request.url).origin;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Endpoints that never authenticate with the browser session: provider
 * webhooks verify a signature or a secret in their URL, the booking pages
 * serve guests (possibly embedded on a sibling subdomain) and the open
 * pixel is a public GIF.
 */
export const SESSION_ORIGIN_EXEMPT_PATHS = ["/api/inbound", "/api/public/", "/api/i/"] as const;

/** Cookies that carry a browser session (`ep_session`) or the account switcher's tokens (`ep_accounts`). */
const SESSION_COOKIE_PATTERN = /(?:^|;\s*)(?:ep_session|ep_accounts)=[^;]/;

function isExemptPath(pathname: string): boolean {
	return SESSION_ORIGIN_EXEMPT_PATHS.some((prefix) =>
		prefix.endsWith("/") ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

/**
 * Whether the central guard must check this request's origin: a mutating
 * `/api/*` call that rides the session cookie. Bearer requests (API keys,
 * mobile device keys, scripts holding a session token) cannot be forged by
 * another site, and a request without the session cookie has no ambient
 * authority to abuse, so both pass untouched.
 */
export function needsSessionOriginCheck(request: Request, pathname = new URL(request.url).pathname): boolean {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
	const path = pathname.replace(/\/{2,}/g, "/");
	if (!path.startsWith("/api/") || isExemptPath(path)) return false;
	if (request.headers.get("Authorization")?.startsWith("Bearer ")) return false;
	return SESSION_COOKIE_PATTERN.test(request.headers.get("Cookie") ?? "");
}

/**
 * Central CSRF guard for cookie-authenticated mutations. Returns the 403 to
 * send, or null to let the request through. The cookie is already
 * `SameSite=Lax`; this also covers same-site (sibling subdomain) requests and
 * browsers without SameSite defaults. Routes keep their own checks too.
 */
export function rejectCrossSiteSessionMutation(request: Request, pathname?: string): Response | null {
	if (!needsSessionOriginCheck(request, pathname)) return null;
	if (hasValidSessionMutationOrigin(request)) return null;
	return Response.json({ error: "Cross-site request blocked" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}
