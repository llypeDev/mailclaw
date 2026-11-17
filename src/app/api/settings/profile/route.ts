import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { getEnv } from "@/lib/cloudflare";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireSessionUser } from "@/lib/api/auth";
import { syncPersonalIdentity } from "@/lib/profile/sync";
import type { UpdateProfileInput } from "./types";
import { parseUpdateProfileRequest } from "./utils";

export async function PATCH(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	const user = auth.user;
	let parsed: UpdateProfileInput;
	try {
		parsed = await parseUpdateProfileRequest(request);
	} catch (err) {
		if (err instanceof ZodError) {
			return NextResponse.json({ error: err.flatten() }, { status: 400 });
		}
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}

	const db = getDb(env);
	const canForwardEmail = true;
	const forwardingEmail = parsed.forwardingEmail === undefined ? user.forwardingEmail : parsed.forwardingEmail;
	await syncPersonalIdentity(db, {
		userId: user.id,
		name: parsed.name,
		avatarKey: user.avatarKey,
	});
	await db
		.update(users)
		.set({ resetEmail: parsed.resetEmail, forwardingEmail })
		.where(eq(users.id, user.id));

	return NextResponse.json({
		user: {
			id: user.id,
			email: user.email,
			name: parsed.name,
			resetEmail: parsed.resetEmail,
			forwardingEmail,
			canForwardEmail,
		},
	});
}
