export type DnsSkippedDomain = { id: string; hostname: string };

/**
 * `GET /api/bootstrap`: what a signed-in page needs before it can render, in one request.
 * `session` is the `/api/auth/me` body. Every other part is `null` when it could not be read, and the
 * client then falls back to that part's own endpoint.
 */
export type BootstrapResponse = {
	session: Record<string, unknown> & { user?: Record<string, unknown> | null };
	/** The `/api/mailboxes` items, unreduced; the client maps them like that endpoint's answer. */
	mailboxes: object[] | null;
	canCreateShared: boolean | null;
	assistantEnabled: boolean | null;
	/** Domains whose DNS setup was skipped; `null` also when the banner cannot apply to this user. */
	dnsSkippedDomains: DnsSkippedDomain[] | null;
};

/** What the extra parts of the bootstrap seed on the client, kept beside the session cache. */
export type BootstrapExtras = Omit<BootstrapResponse, "session" | "mailboxes" | "canCreateShared">;

/** The fetch an inline script starts while the page's JavaScript is still downloading. */
export type EarlyBootstrap = { at: number; response: Promise<Response | null> };
