import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api/auth";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { getBackupConfigurationStatus } from "@/lib/backups/export";
import { runDatabaseBackup } from "@/lib/backups/runner";
import {
	createBackupRecord,
	getBackupSettings,
	listBackups,
	updateBackupSettings,
} from "@/lib/backups/service";
import { getEnv } from "@/lib/cloudflare";
import { parseBackupSettingsInput } from "./utils";

export async function GET(request: Request) {
	const env = getEnv();
	const { user, error } = await requireSessionUser(env, request);
	if (error) return error;
	try {
		assertPrimaryAdmin(user);
		const [settings, backupList] = await Promise.all([
			getBackupSettings(env),
			listBackups(env),
		]);
		return NextResponse.json({
			settings,
			backups: backupList,
			configuration: getBackupConfigurationStatus(env),
		});
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}

export async function PUT(request: Request) {
	const env = getEnv();
	const { user, error } = await requireSessionUser(env, request);
	if (error) return error;
	try {
		assertPrimaryAdmin(user);
		const input = parseBackupSettingsInput(await request.json());
		if (!input) return NextResponse.json({ error: "Invalid backup settings" }, { status: 400 });
		await updateBackupSettings(env, input);
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}

export async function POST(request: Request) {
	const env = getEnv();
	const { user, error: authError } = await requireSessionUser(env, request);
	if (authError) return authError;
	try {
		assertPrimaryAdmin(user);
		const backupId = await createBackupRecord(env, "manual", user.id);
		await runDatabaseBackup(env, backupId);
		return NextResponse.json({ backupId });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Failed to run backup";
		return NextResponse.json({ error: message }, { status: 400 });
	}
}
