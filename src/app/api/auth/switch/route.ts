import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/cloudflare";
import {
	ACCOUNTS_COOKIE,
	cookieOptions,
	isSameOrigin,
	parseAccountTokens,
	resolveAccounts,
	serializeAccountTokens,
} from "@/lib/auth/accounts";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { shouldReturnSessionToken } from "@/lib/auth/login-response-utils";

/**
 * Make another signed-in account the active one. The client names a user id;
 * the token comes from the httpOnly accounts cookie and is re-validated here.
 * Like a sign-in, the new session reaches browsers only as the httpOnly
 * cookie (`authenticated: true` says it changed); `token` is included only for
 * non-browser callers, so page script cannot read a session out of the JSON.
 */
export async function POST(request: Request) {
	if (!isSameOrigin(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	const env = getEnv();
	const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
	const userId = typeof body?.userId === "string" ? body.userId : "";
	const jar = await cookies();
	const accounts = await resolveAccounts(env, parseAccountTokens(jar.get(ACCOUNTS_COOKIE)?.value));
	const target = accounts.find((account) => account.userId === userId);
	if (!target) return NextResponse.json({ error: "Sign in again to use this account" }, { status: 401 });

	const response = NextResponse.json({
		ok: true,
		authenticated: true,
		...(shouldReturnSessionToken(request) ? { token: target.token } : {}),
		redirect: "/inbox",
	});
	response.headers.set("Cache-Control", "no-store");
	response.cookies.set(SESSION_COOKIE, target.token, cookieOptions(request));
	// Prune dead entries while we are here.
	response.cookies.set(ACCOUNTS_COOKIE, serializeAccountTokens(accounts.map((account) => account.token)), cookieOptions(request));
	return response;
}
