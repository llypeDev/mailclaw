// Shared by tests/search.test.mjs: the same mailbox is searched on SQLite (FTS5 index)
// and, in a child process, on PostgreSQL through PGlite (substring LIKE fallback).

export const SEARCH_QUERIES = [
	"invoice",
	"inv",
	"from:maya",
	"to:maya",
	"subject:lunch",
	"title:lunch",
	"\"find the invoice\"",
	"\"invoice find\"",
	"-invoice",
	"-invoice -pizza",
	"-maya@acme.test",
	"-lunch is:read",
	"-logo to:kevin",
	"pizza -sushi",
	"lunch -sushi",
	"has:attachment",
	"is:unread",
	"is:starred",
	":read",
	"after:2026-09-15 before:2026-10-01",
	"maya@acme.test",
	"order",
	"100%",
	"a_b",
	"to:lee",
	"from:maya subject:invoice is:unread",
	"",
	"\"unterminated",
	"a\"b",
	"( * NEAR AND OR NOT",
	"-",
];

const user = "u1";
const at = (iso) => new Date(iso);

export async function seedSearchMailbox(db, schema) {
	const { users, domains, mailboxes, messages, messageAttachments } = schema;
	await db.insert(users).values({ id: user, email: "kevin@example.com", name: "Kevin", passwordHash: "x" });
	await db.insert(domains).values({ id: "d1", userId: user, hostname: "example.com", zoneId: "zone" });
	await db.insert(mailboxes).values({ id: "mb1", userId: user, domainId: "d1", localPart: "kevin" });
	await db.insert(mailboxes).values({ id: "mb2", userId: user, domainId: "d1", localPart: "other" });
	const message = (id, fields) => db.insert(messages).values({
		id,
		userId: user,
		mailboxId: "mb1",
		direction: "inbound",
		status: "received",
		read: true,
		starred: false,
		ccAddr: null,
		textBody: null,
		htmlBody: null,
		...fields,
	});
	await message("m1", { fromAddr: "maya@acme.test", toAddr: "sam@example.com", subject: "Invoice September", textBody: "Please find the invoice attached", read: false, createdAt: at("2026-09-10T12:00:00Z") });
	await message("m2", { fromAddr: "sam@example.com", toAddr: "Maya Okoro <maya@acme.test>", ccAddr: "lee@example.com", subject: "Lunch plans", textBody: "Pizza or sushi?", starred: true, createdAt: at("2026-09-20T12:00:00Z") });
	await message("m3", { fromAddr: "billing@vendor.test", toAddr: "kevin@example.com", subject: "Receipt", htmlBody: "<p>Your receipt for 100% of the order</p>", createdAt: at("2026-10-02T12:00:00Z") });
	await message("m4", { fromAddr: "design@acme.test", toAddr: "kevin@example.com", subject: "Logo", textBody: "see logo", createdAt: at("2026-10-05T12:00:00Z") });
	await message("m5", { fromAddr: "ops@example.com", toAddr: "kevin@example.com", subject: "axb report", textBody: "nothing to see", createdAt: at("2026-10-06T12:00:00Z") });
	await message("m6", { fromAddr: "pizza@example.com", toAddr: "kevin@example.com", subject: "Pizza menu", textBody: "pizza tonight", createdAt: at("2026-10-07T12:00:00Z") });
	// Another mailbox's message proves the conditions are only ANDed with the caller's scope.
	await message("x1", { mailboxId: "mb2", fromAddr: "maya@acme.test", toAddr: "other@example.com", subject: "Invoice copy", textBody: "invoice", read: false });
	await db.insert(messageAttachments).values({ id: "a1", messageId: "m3", filename: "receipt.pdf", contentType: "application/pdf", size: 10, disposition: "attachment", r2Key: "att/a1" });
	await db.insert(messageAttachments).values({ id: "a2", messageId: "m4", filename: "logo.png", contentType: "image/png", size: 10, disposition: "inline", contentId: "logo", r2Key: "att/a2" });
}

/** Runs every query scoped to mailbox mb1; a query that throws reports its error message instead of ids. */
export async function runSearchQueries(db, schema, buildSearchConditions, { and, asc, eq }) {
	const { messages } = schema;
	const results = {};
	for (const query of SEARCH_QUERIES) {
		try {
			const rows = await db
				.select({ id: messages.id })
				.from(messages)
				.where(and(eq(messages.mailboxId, "mb1"), ...buildSearchConditions(query, "UTC")))
				.orderBy(asc(messages.id));
			results[query] = rows.map((row) => row.id);
		} catch (error) {
			results[query] = { error: String(error?.cause?.message ?? error?.message ?? error) };
		}
	}
	return results;
}
