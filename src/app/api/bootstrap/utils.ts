import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { getAgentEnabled } from "@/lib/agent/provider";
import type { SignedInUser } from "@/lib/auth/session-info";
import { canSeeDnsSkippedBanner } from "@/lib/bootstrap/utils";
import type { BootstrapResponse } from "@/lib/bootstrap/types";
import { domainListOwnerIds } from "@/lib/domains/utils";
import { listMailboxOptions } from "@/lib/mailboxes/mailbox-options";

async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
	try {
		return await work();
	} catch {
		return null;
	}
}

/** The same domains `/api/domains` lists for this user, reduced to those with skipped DNS setup. */
async function listDnsSkippedDomains(env: CloudflareEnv, user: SignedInUser) {
	const ownerIds = domainListOwnerIds(user);
	return getDb(env)
		.select({ id: domains.id, hostname: domains.hostname })
		.from(domains)
		.where(and(
			ownerIds.length === 1 ? eq(domains.userId, ownerIds[0]) : inArray(domains.userId, ownerIds),
			eq(domains.dnsSkipped, true),
		));
}

/** Each part fails on its own (`null`), so one missing table never costs the user their session. */
export async function loadBootstrapExtras(env: CloudflareEnv, user: SignedInUser): Promise<Omit<BootstrapResponse, "session">> {
	const [mailboxList, assistantEnabled, dnsSkippedDomains] = await Promise.all([
		orNull(() => listMailboxOptions(env, getDb(env), user)),
		orNull(() => getAgentEnabled(env)),
		canSeeDnsSkippedBanner(user) ? orNull(() => listDnsSkippedDomains(env, user)) : Promise.resolve(null),
	]);
	return {
		mailboxes: mailboxList?.mailboxes ?? null,
		canCreateShared: mailboxList?.canCreateShared ?? null,
		assistantEnabled,
		dnsSkippedDomains,
	};
}
