import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/cookies";
import { buildSessionInfo } from "@/lib/auth/session-info";
import { getEnv } from "@/lib/cloudflare";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	return NextResponse.json(await buildSessionInfo(env, user));
}
