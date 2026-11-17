export const BOOTSTRAP_PATH = "/api/bootstrap";
export const EARLY_BOOTSTRAP_GLOBAL = "__mailclawBootstrap";
/** An early response older than this belongs to an earlier boot and is ignored. */
export const EARLY_BOOTSTRAP_MAX_AGE_MS = 30_000;

/**
 * Who can be shown the "DNS setup skipped" banner: the accounts that own or manage domains. Everyone
 * else has no domains of their own, so neither the server nor the client looks the list up for them.
 */
export function canSeeDnsSkippedBanner(user: {
	role?: string | null;
	isPrimaryAdmin?: boolean | null;
	canManageDomains?: boolean | null;
	canManageMailboxes?: boolean | null;
} | null | undefined): boolean {
	return !!user && (user.role === "admin" || !!user.isPrimaryAdmin || !!user.canManageDomains || !!user.canManageMailboxes);
}

/**
 * Inline script for the server-rendered HTML of a protected page: it starts the bootstrap request
 * with the session cookie while the JavaScript bundles are still downloading, so the session and
 * mailboxes are on their way before hydration. The client takes the response once (`takeEarlyBootstrap`).
 */
export const earlyBootstrapScript = `try{if(!window.${EARLY_BOOTSTRAP_GLOBAL}&&window.fetch){var o={cache:"no-store",credentials:"same-origin"};if(window.AbortSignal&&AbortSignal.timeout)o.signal=AbortSignal.timeout(10000);window.${EARLY_BOOTSTRAP_GLOBAL}={at:Date.now(),response:fetch(${JSON.stringify(BOOTSTRAP_PATH)},o).catch(function(){return null})}}}catch(e){}`;
