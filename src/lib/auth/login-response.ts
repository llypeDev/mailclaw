import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCOUNTS_COOKIE, rememberLogin } from "@/lib/auth/accounts";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/session-cookie";
import { recordAuthActivity } from "@/lib/auth/activity";
import type { AuthActivityAction } from "@/lib/auth/activity-types";
import { shouldReturnSessionToken } from "./login-response-utils";

/**
 * The one place a verified sign-in turns into a session: the httpOnly cookie,
 * account switcher entry, and audit log. Browsers never see the token itself;
 * `authenticated: true` tells the client a session now exists. Non-browser
 * callers (no Sec-Fetch-Site/Origin) still get `token` for Bearer use.
 */
export async function completeLogin(
	env: CloudflareEnv,
	request: Request,
	userId: string,
	options: { activity?: AuthActivityAction; body?: Record<string, unknown> } = {},
): Promise<NextResponse> {
	const token = await createSession(env, userId);
	await recordAuthActivity(env, { action: options.activity ?? "auth.login", userId, request });
	const response = NextResponse.json({
		ok: true,
		authenticated: true,
		...(shouldReturnSessionToken(request) ? { token } : {}),
		redirect: "/inbox",
		...options.body,
	});
	response.headers.set("Cache-Control", "no-store");
	setSessionCookie(response, request, token);
	const accountsJar = await cookies();
	await rememberLogin(env, response, accountsJar.get(ACCOUNTS_COOKIE)?.value, token, accountsJar.get(SESSION_COOKIE)?.value);
	return response;
}
