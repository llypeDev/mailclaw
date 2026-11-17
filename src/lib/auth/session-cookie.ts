import { SESSION_COOKIE } from "@/lib/auth/session";

const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Whether the browser reached us over HTTPS. Workers always see https; the
 * Node server sees http behind a TLS proxy, which says so in X-Forwarded-Proto.
 */
export function isHttpsRequest(request: Request): boolean {
	if (new URL(request.url).protocol === "https:") return true;
	const forwarded = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
	return forwarded === "https";
}

/**
 * `Secure` in production unless the request plainly arrived over http (the
 * Docker quick start at http://host:3000). Browsers drop a Secure cookie set
 * over http, and since the session lives only in this httpOnly cookie, a
 * dropped cookie would mean no way to stay signed in.
 */
export function sessionCookieOptions(request: Request, maxAge = SESSION_MAX_AGE) {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production" && isHttpsRequest(request),
		sameSite: "lax" as const,
		path: "/",
		maxAge,
	};
}

export function setSessionCookie(
	response: { cookies: { set: (name: string, value: string, options: ReturnType<typeof sessionCookieOptions>) => unknown } },
	request: Request,
	token: string,
): void {
	response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(request));
}
