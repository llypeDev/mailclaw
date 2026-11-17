import { NextResponse } from "next/server";
import { hasAdminAccount } from "@/lib/auth/setup";
import { getEnv } from "@/lib/cloudflare";
import { getSetupRequirementChecks } from "@/lib/setup/configuration";
import { DatabaseNotEmptyError, migrateCleanDatabase } from "@/lib/setup/migration";

export async function POST() {
	const env = getEnv();
	const checks = getSetupRequirementChecks(env);

	try {
		if (await hasAdminAccount(env)) {
			return NextResponse.json({ error: "Initial setup is already complete" }, { status: 403 });
		}
		if (checks.some((check) => !check.configured)) {
			return NextResponse.json({ checks, migrated: false }, { status: 503 });
		}

		const migrated = await migrateCleanDatabase(env.DB);
		return NextResponse.json({ checks, migrated });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Database preparation failed";
		const status = error instanceof DatabaseNotEmptyError ? 409 : 500;
		return NextResponse.json({ checks, migrated: false, error: message }, { status });
	}
}
