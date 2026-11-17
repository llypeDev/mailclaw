import { and, eq, gt, lt, sql, type SQL } from "drizzle-orm";
import { getDb, type AppDatabase } from "@/db";
import { loginChallenges } from "@/db/schema";
import { newId } from "@/lib/ids";
import { hashSessionToken } from "@/lib/auth/session";
import { isMissingColumnError } from "@/lib/database-errors";

const CHALLENGE_MINUTES = 5;

/**
 * Second-factor tries one challenge allows. Without it a six-digit code could be
 * guessed for the whole five minutes, limited only per IP; after this many the
 * password has to be entered again.
 */
export const MAX_LOGIN_CHALLENGE_ATTEMPTS = 5;

/** Issued once the password is right; the second factor completes it. */
export async function createLoginChallenge(env: CloudflareEnv, userId: string): Promise<string> {
	const db = getDb(env);
	const token = newId("mfa");
	const expiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1000);
	const row = { id: newId(), userId, tokenHash: await hashSessionToken(token), expiresAt };
	try {
		await db.insert(loginChallenges).values(row);
	} catch (error) {
		// Drizzle lists the attempts column (with its default) in every insert. Before migration 0088 that
		// column is missing, and an admin with MFA could not sign in to apply the migration.
		if (!isMissingAttemptsColumn(error)) throw error;
		const seconds = (date: Date) => Math.floor(date.getTime() / 1000);
		const columns = ["id", "user_id", "token_hash", "expires_at", "created_at"].map((name) => sql.identifier(name));
		await db.run(sql`insert into ${loginChallenges} (${sql.join(columns, sql`, `)}) values (${row.id}, ${row.userId}, ${row.tokenHash}, ${seconds(expiresAt)}, ${seconds(new Date())})`);
	}
	return token;
}

/**
 * The attempts column is missing (migration 0088 not applied). PostgreSQL names a qualified column without
 * quotes ("column login_challenges.attempts does not exist"), which isMissingColumnError does not match.
 */
function isMissingAttemptsColumn(error: unknown): boolean {
	if (isMissingColumnError(error)) return true;
	for (let current = error, depth = 0; current && depth < 5; depth++) {
		if (/column [\w."]*attempts"? does not exist/i.test(current instanceof Error ? current.message : String(current))) return true;
		current = typeof current === "object" && "cause" in current ? (current as { cause?: unknown }).cause : undefined;
	}
	return false;
}

function live(tokenHash: string): SQL {
	return and(eq(loginChallenges.tokenHash, tokenHash), gt(loginChallenges.expiresAt, new Date()))!;
}

async function findChallengeUserId(db: AppDatabase, condition: SQL): Promise<string | null> {
	const [row] = await db.select({ userId: loginChallenges.userId }).from(loginChallenges).where(condition).limit(1);
	return row?.userId ?? null;
}

/**
 * Look a challenge up for one try at its second factor, without consuming it, so a
 * wrong code can be retried within the window. Every call counts as an attempt. The
 * count is a conditional UPDATE, so concurrent requests cannot share the last one,
 * and after MAX_LOGIN_CHALLENGE_ATTEMPTS the challenge no longer matches.
 */
export async function getLoginChallengeUserId(env: CloudflareEnv, token: string): Promise<string | null> {
	const db = getDb(env);
	const tokenHash = await hashSessionToken(token);
	try {
		const rows = await db
			.update(loginChallenges)
			.set({ attempts: sql`${loginChallenges.attempts} + 1` })
			.where(and(live(tokenHash), lt(loginChallenges.attempts, MAX_LOGIN_CHALLENGE_ATTEMPTS)))
			.returning({ userId: loginChallenges.userId });
		return rows[0]?.userId ?? null;
	} catch (error) {
		// Before migration 0088 there is no counter, and signing in must keep working until it is applied.
		if (!isMissingAttemptsColumn(error)) throw error;
		return findChallengeUserId(db, live(tokenHash));
	}
}

/**
 * Look a challenge up without counting an attempt, for a step that checks no factor
 * (starting a passkey ceremony). A challenge that ran out of attempts is still refused.
 */
export async function peekLoginChallengeUserId(env: CloudflareEnv, token: string): Promise<string | null> {
	const db = getDb(env);
	const tokenHash = await hashSessionToken(token);
	try {
		return await findChallengeUserId(db, and(live(tokenHash), lt(loginChallenges.attempts, MAX_LOGIN_CHALLENGE_ATTEMPTS))!);
	} catch (error) {
		if (!isMissingAttemptsColumn(error)) throw error;
		return findChallengeUserId(db, live(tokenHash));
	}
}

/** Returns false when another request already redeemed this challenge. */
export async function consumeLoginChallenge(env: CloudflareEnv, token: string): Promise<boolean> {
	const db = getDb(env);
	const rows = await db
		.delete(loginChallenges)
		.where(live(await hashSessionToken(token)))
		.returning({ id: loginChallenges.id });
	return rows.length > 0;
}
