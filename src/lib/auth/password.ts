import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import {
	formatScryptHash,
	fromUnpaddedBase64,
	isBcryptHash,
	parseScryptHash,
	SCRYPT_KEY_LENGTH,
	SCRYPT_PARAMS,
	SCRYPT_SALT_LENGTH,
	toUnpaddedBase64,
} from "./password-utils";

export { passwordHashNeedsUpgrade } from "./password-utils";

/**
 * Accounts that sign in only with passkeys still need a non-null column value:
 * SQLite cannot drop `NOT NULL` without rebuilding a heavily referenced table.
 * The sentinel can never be produced by hashPassword and every verification
 * path rejects it, so it behaves like a missing password.
 */
export const PASSWORDLESS_PASSWORD_HASH = "!passkey-only";

function deriveScrypt(password: string, salt: Uint8Array, keyLength: number, logN: number, r: number, p: number): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		// Async so the Node server runs it on the libuv pool instead of its event loop.
		scrypt(password.normalize("NFKC"), salt, keyLength, { N: 2 ** logN, r, p }, (error, key) => {
			if (error) reject(error);
			else resolve(new Uint8Array(key.buffer, key.byteOffset, key.byteLength));
		});
	});
}

/** Native scrypt (node:crypto on both Node and Workers with nodejs_compat). */
export async function hashPassword(password: string): Promise<string> {
	const salt = new Uint8Array(randomBytes(SCRYPT_SALT_LENGTH));
	const { logN, r, p } = SCRYPT_PARAMS;
	const key = await deriveScrypt(password, salt, SCRYPT_KEY_LENGTH, logN, r, p);
	return formatScryptHash(SCRYPT_PARAMS, toUnpaddedBase64(salt), toUnpaddedBase64(key));
}

export function hasPasswordHash(hash: string | null | undefined): hash is string {
	if (!hash || hash === PASSWORDLESS_PASSWORD_HASH) return false;
	return isBcryptHash(hash) || parseScryptHash(hash) !== null;
}

/**
 * Checks a password against a scrypt hash or a legacy bcrypt one. Callers
 * that sign someone in should follow a success with
 * `upgradePasswordHashIfNeeded` so bcrypt rows move to scrypt.
 */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
	if (!hasPasswordHash(hash)) return false;
	if (isBcryptHash(hash)) return bcrypt.compareSync(password, hash);
	const parsed = parseScryptHash(hash);
	if (!parsed) return false;
	const expected = fromUnpaddedBase64(parsed.hash);
	if (expected.length < 16 || expected.length > 64) return false;
	const derived = await deriveScrypt(password, fromUnpaddedBase64(parsed.salt), expected.length, parsed.logN, parsed.r, parsed.p);
	return timingSafeEqual(derived, expected);
}
