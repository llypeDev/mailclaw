// Shared by tests/message-counters.test.mjs: a random sequence of message writes, after which the
// counts built from message_counters must equal the grouped query they replace. Runs on SQLite in
// the test process and on PostgreSQL (PGlite) in a child process, since the schema dialect is fixed
// per process.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

const STATUSES = ["received", "sent", "draft", "spam", "trash", "archived", "queued", "failed"];
const DAY = 86_400_000;

/** mulberry32: a small seeded PRNG, so a failing sequence can be replayed. */
function random(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The order of `mailboxes` and of the `customFolders` keys follows the row order of the query,
 * which the old GROUP BY left to the planner; compare both as sets.
 */
export function normalizeCounts(counts) {
	const copy = JSON.parse(JSON.stringify(counts));
	copy.mailboxes.sort((a, b) => (a.mailboxId < b.mailboxId ? -1 : a.mailboxId > b.mailboxId ? 1 : 0));
	copy.customFolders = Object.fromEntries(Object.entries(copy.customFolders).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	return copy;
}

export async function seedCounterAccounts(db, schema) {
	const { users, domains, mailboxes, folders } = schema;
	await db.insert(users).values([
		{ id: "u1", email: "one@example.com", name: "One", passwordHash: "x" },
		{ id: "u2", email: "two@example.com", name: "Two", passwordHash: "x" },
		{ id: "u3", email: "three@example.com", name: "Three", passwordHash: "x" },
	]);
	await db.insert(domains).values({ id: "d1", userId: "u1", hostname: "example.com", zoneId: "zone" });
	await db.insert(mailboxes).values([
		{ id: "mb1", userId: "u1", domainId: "d1", localPart: "one" },
		{ id: "mb2", userId: "u1", domainId: "d1", localPart: "shared" },
		{ id: "mb3", userId: "u2", domainId: "d1", localPart: "two" },
	]);
	await db.insert(folders).values([
		{ id: "f1", userId: "u1", mailboxId: "mb1", name: "Receipts" },
		{ id: "f2", userId: "u1", mailboxId: "mb1", name: "Travel" },
		{ id: "f3", userId: "u1", mailboxId: "mb2", name: "Projects" },
	]);
}

/**
 * Applies `steps` random writes through drizzle and, every `every` steps, compares
 * every scope. Returns the mismatches (empty when the counters are right).
 */
export async function runCounterScenario(db, schema, app, { seed = 1, steps = 400, every = 20 } = {}) {
	const { messages, folders, mailboxes, outboundJobs, messageCounters } = schema;
	const next = random(seed);
	const pick = (list) => list[Math.floor(next() * list.length)];
	const chance = (p) => next() < p;
	const now = Date.now();
	const mismatches = [];
	let mailboxIds = ["mb1", "mb2", "mb3"];
	let folderIds = ["f1", "f2", "f3"];
	let sequence = 0;
	let checks = 0;

	const snooze = () => (chance(0.6) ? null : chance(0.5) ? new Date(now + DAY) : new Date(now - DAY));
	const messageIds = async () => (await db.select({ id: messages.id }).from(messages)).map((row) => row.id);
	const randomFields = () => {
		const fields = {};
		if (chance(0.3)) fields.status = pick(STATUSES);
		if (chance(0.3)) fields.read = chance(0.5);
		if (chance(0.3)) fields.starred = chance(0.5);
		if (chance(0.2)) fields.folderId = chance(0.5) ? null : pick(folderIds);
		if (chance(0.15)) fields.mailboxId = chance(0.15) ? null : pick(mailboxIds);
		if (chance(0.2)) fields.snoozedUntil = snooze();
		if (chance(0.1)) fields.direction = chance(0.5) ? "inbound" : "outbound";
		if (chance(0.1)) fields.subject = `edited ${sequence}`;
		return fields;
	};

	async function compare(step) {
		checks += 1;
		const scopes = [[mailboxIds[0]], mailboxIds.slice(0, 2), mailboxIds, [...mailboxIds, "missing"]];
		for (const ids of scopes) {
			const actual = normalizeCounts(await app.loadMessageCounts(db, { mailboxIds: ids }));
			const expected = normalizeCounts(await app.loadGroupedMessageCounts(db, inArray(messages.mailboxId, ids)));
			if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ step, scope: ids, actual, expected });
		}
		const user = normalizeCounts(await app.loadMessageCounts(db, { userId: "u1" }));
		const userExpected = normalizeCounts(await app.loadGroupedMessageCounts(db, eq(messages.userId, "u1")));
		if (JSON.stringify(user) !== JSON.stringify(userExpected)) mismatches.push({ step, scope: "user u1", actual: user, expected: userExpected });

		// The merged tallies themselves, against a direct grouping (what JMAP folds).
		const tallies = await app.loadCounterRows(db, mailboxIds);
		const grouped = await db
			.select({
				mailboxId: messages.mailboxId,
				folderId: messages.folderId,
				direction: messages.direction,
				status: messages.status,
				read: messages.read,
				starred: messages.starred,
				total: sql`count(*)`.mapWith(Number),
			})
			.from(messages)
			.where(inArray(messages.mailboxId, mailboxIds))
			.groupBy(messages.mailboxId, messages.folderId, messages.direction, messages.status, messages.read, messages.starred);
		const key = (row) => JSON.stringify([row.mailboxId, row.folderId ?? null, row.direction, row.status, !!row.read, !!row.starred, Number(row.total)]);
		const a = tallies.map(key).sort();
		const b = grouped.map(key).sort();
		if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push({ step, scope: "tallies", actual: a, expected: b });
	}

	async function write() {
		sequence += 1;
		const roll = next();
		if (roll < 0.35) {
			const direction = chance(0.6) ? "inbound" : "outbound";
			const id = `m${sequence}`;
			await db.insert(messages).values({
				id,
				userId: pick(["u1", "u2"]),
				mailboxId: chance(0.08) ? null : pick(mailboxIds),
				folderId: chance(0.6) ? null : pick(folderIds),
				direction,
				fromAddr: "a@example.com",
				toAddr: "b@example.com",
				status: direction === "inbound" ? pick(["received", "received", "spam", "trash", "archived"]) : pick(STATUSES),
				read: chance(0.5),
				starred: chance(0.2),
				snoozedUntil: snooze(),
				createdAt: new Date(now - sequence * 1000),
			});
		} else if (roll < 0.62) {
			const ids = await messageIds();
			if (!ids.length) return;
			const fields = randomFields();
			if (!Object.keys(fields).length) fields.read = chance(0.5);
			await db.update(messages).set(fields).where(eq(messages.id, pick(ids)));
		} else if (roll < 0.68) {
			// A write that changes nothing counted must leave the tallies alone.
			const ids = await messageIds();
			if (!ids.length) return;
			const [row] = await db.select().from(messages).where(eq(messages.id, pick(ids)));
			await db.update(messages).set({ read: row.read, starred: row.starred, status: row.status }).where(eq(messages.id, row.id));
		} else if (roll < 0.74) {
			// Bulk actions update many rows in one statement.
			const mailbox = pick(mailboxIds);
			await db.update(messages).set(chance(0.5) ? { read: chance(0.5) } : { status: pick(["archived", "trash", "received"]) }).where(eq(messages.mailboxId, mailbox));
		} else if (roll < 0.84) {
			const ids = await messageIds();
			if (ids.length) await db.delete(messages).where(eq(messages.id, pick(ids)));
		} else if (roll < 0.9) {
			// Scheduled sends: a queued outbound message with a waiting job.
			const queued = await db.select({ id: messages.id, userId: messages.userId }).from(messages).where(and(eq(messages.direction, "outbound"), eq(messages.status, "queued")));
			if (!queued.length) return;
			const target = pick(queued);
			await db.insert(outboundJobs).values({ id: `j${sequence}`, userId: target.userId, messageId: target.id, status: pick(["queued", "queued", "sending"]), payload: "{}", scheduledAt: chance(0.8) ? new Date(now + DAY) : null });
		} else if (roll < 0.95) {
			// Deleting a folder nulls folder_id through the foreign key, not through the app.
			if (folderIds.length > 1 && chance(0.5)) {
				const folder = pick(folderIds);
				await db.delete(folders).where(eq(folders.id, folder));
				folderIds = folderIds.filter((id) => id !== folder);
			} else {
				const id = `f${sequence}`;
				const mailbox = pick(mailboxIds);
				const [owner] = await db.select({ userId: mailboxes.userId }).from(mailboxes).where(eq(mailboxes.id, mailbox));
				await db.insert(folders).values({ id, userId: owner.userId, mailboxId: mailbox, name: `Folder ${sequence}` });
				folderIds.push(id);
			}
		} else if (roll < 0.97 && mailboxIds.length > 2) {
			// Deleting a mailbox nulls mailbox_id and drops its folders through foreign keys.
			const mailbox = pick(mailboxIds.slice(1));
			const dropped = (await db.select({ id: folders.id }).from(folders).where(eq(folders.mailboxId, mailbox))).map((row) => row.id);
			await db.delete(mailboxes).where(eq(mailboxes.id, mailbox));
			mailboxIds = mailboxIds.filter((id) => id !== mailbox);
			folderIds = folderIds.filter((id) => !dropped.includes(id));
			const id = `mb${sequence}`;
			await db.insert(mailboxes).values({ id, userId: "u2", domainId: "d1", localPart: `box${sequence}` });
			mailboxIds.push(id);
		} else {
			// Re-file: move a message to another mailbox and folder at once.
			const ids = await messageIds();
			if (!ids.length) return;
			await db.update(messages).set({ mailboxId: pick(mailboxIds), folderId: chance(0.5) ? null : pick(folderIds) }).where(eq(messages.id, pick(ids)));
		}
	}

	for (let step = 1; step <= steps; step += 1) {
		await write();
		if (step % every === 0) await compare(step);
	}
	await compare(steps);

	const stored = await db.select({ total: sql`count(*)`.mapWith(Number) }).from(messageCounters).where(isNotNull(messageCounters.mailboxId));
	const messageTotal = await db.select({ total: sql`count(*)`.mapWith(Number) }).from(messages);
	return { mismatches, checks, counterRows: stored[0].total, messageRows: messageTotal[0].total, mailboxIds };
}
