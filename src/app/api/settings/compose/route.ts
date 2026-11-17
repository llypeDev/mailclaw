import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { readJsonObjectBody } from "@/lib/http/request";
import { parseUndoSendSeconds } from "@/lib/compose/compose-utils";
import { ComposePreferencesUnavailableError, getComposePreferences, updateComposePreferences } from "@/lib/compose/preferences";
import type { ComposePreferences } from "@/lib/compose/types";

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	return NextResponse.json(await getComposePreferences(env, auth.user.id));
}

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const read = await readJsonObjectBody(request);
	if ("response" in read) return read.response;
	const body = read.body;
	const patch: Partial<ComposePreferences> = {};
	if ("trackOpensDefault" in body) {
		if (typeof body.trackOpensDefault !== "boolean") return NextResponse.json({ error: "trackOpensDefault must be a boolean" }, { status: 400 });
		patch.trackOpensDefault = body.trackOpensDefault;
	}
	if ("undoSendSeconds" in body) {
		const seconds = parseUndoSendSeconds(body.undoSendSeconds);
		if (seconds === null) return NextResponse.json({ error: "undoSendSeconds must be 0, 5, 10, 15 or 30" }, { status: 400 });
		patch.undoSendSeconds = seconds;
	}
	if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
	try {
		return NextResponse.json(await updateComposePreferences(env, auth.user.id, patch));
	} catch (error) {
		if (error instanceof ComposePreferencesUnavailableError) {
			return NextResponse.json({ error: error.message, code: "MIGRATION_REQUIRED" }, { status: 409 });
		}
		throw error;
	}
}
