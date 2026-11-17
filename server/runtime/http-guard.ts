import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { rejectCrossSiteSessionMutation } from "@/lib/auth/origin";

/**
 * A body-less `Request` mirroring an incoming Node request, for guards that only
 * read the method, URL and headers. The origin is the one the browser used:
 * scheme and host from the reverse proxy's X-Forwarded-* headers when it is
 * trusted, otherwise from the socket and the Host header.
 */
export function guardRequest(request: IncomingMessage, trustProxy: boolean): Request {
	const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim() || undefined;
	const proto = (trustProxy ? first(request.headers["x-forwarded-proto"]) : undefined)
		?? ((request.socket as TLSSocket).encrypted ? "https" : "http");
	const host = (trustProxy ? first(request.headers["x-forwarded-host"]) : undefined) ?? first(request.headers.host) ?? "localhost";
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		for (const item of Array.isArray(value) ? value : [value]) {
			try {
				headers.append(name, item);
			} catch {
				// A header undici will not carry cannot matter to the guard.
			}
		}
	}
	const path = (request.url ?? "/").startsWith("/") ? request.url ?? "/" : "/";
	return new Request(new URL(path, `${proto === "https" ? "https" : "http"}://${host}`), { method: request.method ?? "GET", headers });
}

/**
 * The CSRF guard worker.ts runs before vinext, for the Node server: answers a
 * cross-site cookie-authenticated `/api` mutation with the guard's 403 and
 * returns true, or returns false to let Next handle the request. Done here
 * rather than in a Next proxy, which would buffer (and on Node cap) upload bodies.
 */
export async function rejectCrossSiteNodeRequest(request: IncomingMessage, response: ServerResponse, trustProxy: boolean): Promise<boolean> {
	let blocked: Response | null;
	try {
		blocked = rejectCrossSiteSessionMutation(guardRequest(request, trustProxy));
	} catch {
		// A request that cannot even be described (a malformed Host) is refused rather than let past the guard.
		blocked = Response.json({ error: "Bad request" }, { status: 400 });
	}
	if (!blocked) return false;
	response.statusCode = blocked.status;
	blocked.headers.forEach((value, name) => response.setHeader(name, value));
	response.end(Buffer.from(await blocked.arrayBuffer()));
	// The body was never read; drop the rest of the upload instead of keeping the socket busy.
	request.resume();
	return true;
}
