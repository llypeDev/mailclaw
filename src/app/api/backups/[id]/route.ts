import { NextResponse } from "next/server";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireSessionUser } from "@/lib/api/auth";
import { deleteBackup } from "@/lib/backups/service";
import { getEnv } from "@/lib/cloudflare";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const env = getEnv();
	const { user, error } = await requireSessionUser(env, request);
	if (error) return error;
	try {
		assertPrimaryAdmin(user);
		const { id } = await params;
		const deleted = await deleteBackup(env, id);
		if (!deleted) return NextResponse.json({ error: "Backup not found" }, { status: 404 });
		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
}
