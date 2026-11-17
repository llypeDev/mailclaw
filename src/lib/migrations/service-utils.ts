/**
 * Pure helpers for the migration runner (service.ts).
 *
 * MySQL commits DDL implicitly, so a migration there cannot be applied atomically. Instead the runner
 * keeps a progress row in the ledger while it works: `<name>#partial:<n>` says the first n statements
 * of `<name>` are committed. A failed run resumes at statement n instead of re-running statements
 * that already took effect, and the progress row is renamed to `<name>` when the last statement is
 * done, which is what marks the migration applied.
 */

const PARTIAL_MARKER = "#partial:";

/** Advisory lock key for PostgreSQL ("mail" in ASCII); any constant works as long as every runner uses it. */
export const POSTGRES_MIGRATION_LOCK_KEY = 1835100524;
/** Name of the MySQL user-level lock (GET_LOCK) held for a whole migration run. */
export const MYSQL_MIGRATION_LOCK_NAME = "mailclaw_migrations";
/** How long a second runner waits for the first to finish before giving up. */
export const MYSQL_MIGRATION_LOCK_TIMEOUT_SECONDS = 120;

export function progressMarker(name: string, completedStatements: number): string {
	return `${name}${PARTIAL_MARKER}${completedStatements}`;
}

export function isProgressMarker(name: string): boolean {
	return name.includes(PARTIAL_MARKER);
}

export type LedgerState = {
	/** Migrations recorded as fully applied. */
	applied: Set<string>;
	/** Migrations interrupted part-way: the ledger row naming the progress and how many statements are committed. */
	partial: Map<string, { marker: string; completed: number }>;
};

export function parseLedgerNames(names: Iterable<string>): LedgerState {
	const applied = new Set<string>();
	const partial = new Map<string, { marker: string; completed: number }>();
	for (const name of names) {
		const at = name.lastIndexOf(PARTIAL_MARKER);
		if (at === -1) {
			applied.add(name);
			continue;
		}
		const completed = Number(name.slice(at + PARTIAL_MARKER.length));
		if (!Number.isInteger(completed) || completed < 0) continue;
		partial.set(name.slice(0, at), { marker: name, completed });
	}
	return { applied, partial };
}

const ALREADY_APPLIED_CODES = new Set([
	"ER_TABLE_EXISTS_ERROR",
	"ER_DUP_KEYNAME",
	"ER_DUP_FIELDNAME",
	"ER_DUP_ENTRY",
	"ER_FK_DUP_NAME",
	"ER_TRG_ALREADY_EXISTS",
	"ER_SP_ALREADY_EXISTS",
	"ER_CANT_DROP_FIELD_OR_KEY",
	"ER_BAD_TABLE_ERROR",
	"ER_TRG_DOES_NOT_EXIST",
	"ER_SP_DOES_NOT_EXIST",
]);

const ALREADY_APPLIED_ERRNOS = new Set([1050, 1061, 1060, 1062, 1826, 1359, 1304, 1091, 1051, 1360, 1305]);

const ALREADY_APPLIED_TEXT =
	/already exists|Duplicate (?:key name|column name|entry|foreign key constraint name)|check that (?:column\/key|it) exists|Unknown table|does not exist/i;

/**
 * Whether a MySQL error says the statement's effect is already in place (the table, index, column or
 * trigger exists, or the thing it drops is gone). Only used for the one statement a resumed run may
 * repeat: the statement whose progress write was lost after it committed.
 */
export function isAlreadyAppliedMysqlError(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; current && depth < 3; depth += 1) {
		const candidate = current as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
		if (typeof candidate.code === "string" && ALREADY_APPLIED_CODES.has(candidate.code)) return true;
		if (typeof candidate.errno === "number" && ALREADY_APPLIED_ERRNOS.has(candidate.errno)) return true;
		if (typeof candidate.message === "string" && ALREADY_APPLIED_TEXT.test(candidate.message)) return true;
		current = candidate.cause;
	}
	return false;
}
