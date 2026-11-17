import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, passwordHashNeedsUpgrade } from "@/lib/auth/password";

/**
 * After a password verified against `currentHash`, store it again at the
 * current scrypt cost when the row still holds bcrypt (or a weaker scrypt).
 * The update is conditional on the hash being unchanged, so it never undoes
 * a password change that raced it. Failure only skips the upgrade.
 */
export async function upgradePasswordHashIfNeeded(
	env: CloudflareEnv,
	userId: string,
	password: string,
	currentHash: string,
): Promise<void> {
	if (!passwordHashNeedsUpgrade(currentHash)) return;
	try {
		const passwordHash = await hashPassword(password);
		await getDb(env)
			.update(users)
			.set({ passwordHash })
			.where(and(eq(users.id, userId), eq(users.passwordHash, currentHash)));
	} catch (error) {
		console.warn("Could not upgrade the stored password hash", error);
	}
}
