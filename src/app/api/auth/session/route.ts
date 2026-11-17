import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import { ACCOUNTS_COOKIE, rememberLogin } from "@/lib/auth/accounts";
import { getUserFromSession, SESSION_COOKIE } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/session-cookie";

function json(body: unknown, status = 200) {
	return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bearerToken(request: Request): string | undefined {
	const authorization = request.headers.get("Authorization");
	if (!authorization?.startsWith("Bearer ")) return undefined;
	return authorization.slice(7).trim() || undefined;
}

/**
 * Which user the session cookie alone signs in, ignoring any Bearer header.
 * The web client asks this after moving a legacy localStorage token into the
 * cookie, to confirm the browser actually kept the cookie.
 */
export async function GET() {
	const env = getEnv();
	const token = (await cookies()).get(SESSION_COOKIE)?.value;
	const user = await getUserFromSession(env, token);
	if (!user || user.disabled || user.deletedAt) return json({ authenticated: false }, 401);
	return json({ authenticated: true, userId: user.id });
}

/**
 * One-time move of a session token that an older web client kept in
 * localStorage into the httpOnly cookie. Only a Bearer token is accepted, so
 * another site cannot use this to plant a session; whoever holds the token
 * could already use it directly.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const token = bearerToken(request);
	if (!token) return json({ error: "Unauthorized" }, 401);
	const user = await getUserFromSession(env, token);
	if (!user || user.disabled || user.deletedAt) return json({ error: "Unauthorized" }, 401);
	const response = json({ ok: true, authenticated: true, userId: user.id });
	setSessionCookie(response, request, token);
	const jar = await cookies();
	await rememberLogin(env, response, jar.get(ACCOUNTS_COOKIE)?.value, token, jar.get(SESSION_COOKIE)?.value);
	return response;
}
