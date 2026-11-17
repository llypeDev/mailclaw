import { eq, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { mfaRecoveryCodes, users } from "@/db/schema";
import { getBranding } from "@/lib/branding/service";
import { consumeRecoveryCode, countUnusedRecoveryCodes, issueRecoveryCodes } from "@/lib/auth/recovery-codes";
import { deleteUserSessions } from "@/lib/auth/session";
import { buildOtpauthUrl, generateTotpSecret, matchTotpStep } from "@/lib/auth/totp";
import { isMissingColumnError } from "@/lib/database-errors";
import type { MfaEnrollment, MfaStatus } from "@/lib/auth/mfa-types";

/**
 * `users.totp_last_step` (migration 0090; PostgreSQL and MySQL 0014). It is not declared on the
 * Drizzle `users` table: every user read selects all declared columns, so declaring it would break
 * sign-in, and with it the admin page that applies migrations, until the migration ran. Only the
 * statements below touch it, and each tolerates its absence.
 */
const totpLastStep = sql.identifier("totp_last_step");

/**
 * Record `step` as the account's last accepted TOTP step if it is later than the stored one
 * (RFC 6238 section 5.2: a code is accepted once). The check and the write are one conditional
 * UPDATE, so two requests racing with the same code change the row once and only one succeeds.
 * Before the migration there is nothing to compare against and every matching code is accepted.
 */
async function claimTotpStep(env: CloudflareEnv, userId: string, step: number): Promise<boolean> {
	try {
		const result = await getDb(env).run(
			sql`update ${users} set ${totpLastStep} = ${step} where ${sql.identifier("id")} = ${userId} and (${totpLastStep} is null or ${totpLastStep} < ${step})`,
		);
		return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0) === 1;
	} catch (error) {
		if (!isMissingColumnError(error)) throw error;
		return true;
	}
}

/** A new secret starts its own step history; the old secret's steps say nothing about it. */
async function resetTotpStep(env: CloudflareEnv, userId: string): Promise<void> {
	try {
		await getDb(env).run(sql`update ${users} set ${totpLastStep} = null where ${sql.identifier("id")} = ${userId}`);
	} catch (error) {
		if (!isMissingColumnError(error)) throw error;
	}
}

export async function getMfaStatus(env: CloudflareEnv, user: { id: string; totpEnabled: boolean; totpConfirmedAt: Date | null }): Promise<MfaStatus> {
	return {
		enabled: user.totpEnabled,
		confirmedAt: user.totpConfirmedAt?.toISOString() ?? null,
		recoveryCodesLeft: user.totpEnabled ? await countUnusedRecoveryCodes(env, user.id) : 0,
	};
}

/**
 * Start enrolment: a fresh secret is stored but not yet trusted. It only
 * becomes the account's second factor once `confirmMfaEnrollment` sees a
 * code generated from it, which proves the authenticator has it.
 */
export async function beginMfaEnrollment(env: CloudflareEnv, user: { id: string; email: string }): Promise<MfaEnrollment> {
	const db = getDb(env);
	const secret = generateTotpSecret();
	await db.update(users).set({ totpSecret: secret, totpEnabled: false, totpConfirmedAt: null }).where(eq(users.id, user.id));
	await resetTotpStep(env, user.id);
	const { appName } = await getBranding(env);
	const otpauthUrl = buildOtpauthUrl({ issuer: appName, account: user.email, secret });
	const qrSvg = await QRCode.toString(otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
	return { secret, otpauthUrl, qrSvg };
}

export async function confirmMfaEnrollment(
	env: CloudflareEnv,
	user: { id: string; totpSecret: string | null; totpEnabled: boolean },
	code: string,
	currentSessionToken?: string,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
	if (!user.totpSecret) return { ok: false, error: "Start enrolment first" };
	if (user.totpEnabled) return { ok: false, error: "Two-factor authentication is already on" };
	// The confirming code's step is recorded too, so it cannot then complete a sign-in.
	const step = await matchTotpStep(user.totpSecret, code);
	if (step === null || !(await claimTotpStep(env, user.id, step))) {
		return { ok: false, error: "That code did not match. Check the time on your device and try again." };
	}

	const db = getDb(env);
	await db.update(users).set({ totpEnabled: true, totpConfirmedAt: new Date(), requireSecondFactor: true }).where(eq(users.id, user.id));
	const recoveryCodes = await issueRecoveryCodes(env, user.id);
	// Other sessions predate the second factor; make them sign in again with it.
	await deleteUserSessions(env, user.id, currentSessionToken);
	return { ok: true, recoveryCodes };
}

/**
 * Turning TOTP off leaves the second-factor requirement as the account had it:
 * a passkey can take over, but an account that never asked for a second step
 * does not start requiring one. Recovery codes alone are a fallback, not a
 * primary factor, so they do not keep the requirement on.
 */
export async function disableMfa(env: CloudflareEnv, userId: string): Promise<void> {
	const db = getDb(env);
	// The requirement follows the remaining passkeys in the same statement, so a
	// concurrent passkey deletion cannot leave a required-but-missing factor.
	await db
		.update(users)
		.set({
			totpSecret: null,
			totpEnabled: false,
			totpConfirmedAt: null,
			requireSecondFactor: sql`case when ${users.passkeyCount} > 0 then ${users.requireSecondFactor} else false end`,
		})
		.where(eq(users.id, userId));
	await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
}

/**
 * A login's second step: a TOTP code, or one of the recovery codes as a fallback. Login, device
 * sign-in and security changes all come through here, so a TOTP code is accepted only for a step
 * later than the last one any of them accepted.
 */
export async function verifySecondFactor(
	env: CloudflareEnv,
	user: { id: string; totpSecret: string | null; totpEnabled: boolean },
	code: string,
): Promise<"totp" | "recovery" | null> {
	if (user.totpEnabled && user.totpSecret) {
		const step = await matchTotpStep(user.totpSecret, code);
		// A replayed code is refused outright: six digits are never a recovery code.
		if (step !== null) return (await claimTotpStep(env, user.id, step)) ? "totp" : null;
	}
	// Recovery codes belong to the authenticator flow. They must not become a
	// second factor for an account that never enrolled TOTP.
	if (user.totpEnabled && (await consumeRecoveryCode(env, user.id, code))) return "recovery";
	return null;
}
