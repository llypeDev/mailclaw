import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { buildSessionInfo } from "@/lib/auth/session-info";
import { loadBootstrapExtras } from "./utils";

/**
 * Everything a signed-in page waits for before it renders, in one Worker request instead of five:
 * the `/api/auth/me` session, the `/api/mailboxes` list, assistant availability and the domains whose
 * DNS setup was skipped. Those endpoints stay for their other callers and for refreshes.
 */
export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const [session, extras] = await Promise.all([
		buildSessionInfo(env, user),
		loadBootstrapExtras(env, user),
	]);
	return NextResponse.json({ session, ...extras }, { headers: { "Cache-Control": "no-store" } });
}
