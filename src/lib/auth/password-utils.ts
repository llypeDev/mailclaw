/**
 * Stored password hashes are self-describing. New ones are scrypt in PHC
 * string form, `$scrypt$ln=14,r=8,p=1$<salt>$<hash>` (unpadded base64), so
 * the cost can be raised later without a migration. Older rows keep their
 * bcrypt `$2a$`/`$2b$` hashes, still verify, and are replaced with scrypt on
 * the next successful sign-in.
 */

export type ScryptParams = { logN: number; r: number; p: number };
export type ParsedScryptHash = ScryptParams & { salt: string; hash: string };

/**
 * N = 2^14, r = 8 needs 16 MiB. workerd refuses N = 2^15 with r = 8 (its
 * scrypt memory cap), so this is the strongest setting both runtimes accept;
 * it costs roughly 40-50 ms of CPU per hash or verify.
 */
export const SCRYPT_PARAMS: ScryptParams = { logN: 14, r: 8, p: 1 };
export const SCRYPT_KEY_LENGTH = 32;
export const SCRYPT_SALT_LENGTH = 16;

const SCRYPT_PREFIX = "$scrypt$";
const BASE64 = /^[A-Za-z0-9+/]+$/;

export function isBcryptHash(hash: string): boolean {
	return /^\$2[abxy]?\$\d{2}\$/.test(hash);
}

export function isScryptHash(hash: string): boolean {
	return hash.startsWith(SCRYPT_PREFIX);
}

export function formatScryptHash(params: ScryptParams, salt: string, hash: string): string {
	return `${SCRYPT_PREFIX}ln=${params.logN},r=${params.r},p=${params.p}$${salt}$${hash}`;
}

/**
 * Parse a stored scrypt hash. Out-of-range parameters are rejected rather
 * than trusted, so a corrupt or hostile row cannot make verification allocate
 * unbounded memory.
 */
export function parseScryptHash(value: string): ParsedScryptHash | null {
	if (!isScryptHash(value)) return null;
	const parts = value.slice(SCRYPT_PREFIX.length).split("$");
	if (parts.length !== 3) return null;
	const [paramText, salt, hash] = parts as [string, string, string];
	const params = new Map<string, number>();
	for (const entry of paramText.split(",")) {
		const match = /^(ln|r|p)=(\d{1,2})$/.exec(entry);
		if (!match || params.has(match[1]!)) return null;
		params.set(match[1]!, Number(match[2]));
	}
	const logN = params.get("ln");
	const r = params.get("r");
	const p = params.get("p");
	if (logN === undefined || r === undefined || p === undefined) return null;
	if (logN < 10 || logN > 14 || r < 1 || r > 16 || p < 1 || p > 4) return null;
	if ((2 ** logN) * r * 128 > 32 * 1024 * 1024) return null;
	if (!BASE64.test(salt) || !BASE64.test(hash)) return null;
	return { logN, r, p, salt, hash };
}

/** True when a verified hash should be replaced with one at the current cost. */
export function passwordHashNeedsUpgrade(hash: string): boolean {
	if (isBcryptHash(hash)) return true;
	const parsed = parseScryptHash(hash);
	if (!parsed) return false;
	return parsed.logN < SCRYPT_PARAMS.logN || parsed.r !== SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

export function toUnpaddedBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/=+$/, "");
}

export function fromUnpaddedBase64(text: string): Uint8Array {
	const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
