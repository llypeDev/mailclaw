// Shared by tests/login-challenge-attempts.test.mjs and tests/calendar-reminder-candidates.test.mjs:
// each scenario runs on a migrated SQLite database and, in a child process (schema-0088-runner.mjs),
// on PostgreSQL through PGlite. A scenario returns plain JSON so both runs can be compared.

import { sql } from "drizzle-orm";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

async function addUser(app, db, id, { calendarEnabled = true } = {}) {
	await db.insert(app.tables.users).values({ id, email: `${id}@example.test`, name: id, passwordHash: "x", calendarEnabled });
}

/** Five tries per challenge, counted atomically even when requests race. */
export async function challengeAttempts(app, env) {
	const db = app.createDb(env.DB);
	await addUser(app, db, "u1");
	const result = {};

	const token = await app.createLoginChallenge(env, "u1");
	const tries = [];
	for (let i = 0; i < 7; i++) tries.push(await app.getLoginChallengeUserId(env, token));
	result.sequential = tries;
	result.peekAfterExhaustion = await app.peekLoginChallengeUserId(env, token);

	const racing = await app.createLoginChallenge(env, "u1");
	const raced = await Promise.all(Array.from({ length: 12 }, () => app.getLoginChallengeUserId(env, racing)));
	result.racedAccepted = raced.filter(Boolean).length;

	const fresh = await app.createLoginChallenge(env, "u1");
	result.peekDoesNotCount = [];
	for (let i = 0; i < 6; i++) result.peekDoesNotCount.push(await app.peekLoginChallengeUserId(env, fresh));
	result.afterPeeks = await app.getLoginChallengeUserId(env, fresh);
	result.consumed = await app.consumeLoginChallenge(env, fresh);
	result.afterConsume = await app.getLoginChallengeUserId(env, fresh);

	const expired = await app.createLoginChallenge(env, "u1");
	await db.update(app.tables.loginChallenges).set({ expiresAt: new Date(Date.now() - MINUTE) });
	result.expired = await app.getLoginChallengeUserId(env, expired);
	return result;
}

/** Before migration 0088 there is no attempts column: challenges are still issued, checked and redeemed. */
export async function challengeBeforeMigration(app, env) {
	const db = app.createDb(env.DB);
	await addUser(app, db, "u1");
	await db.run(sql`alter table login_challenges drop column attempts`);
	const token = await app.createLoginChallenge(env, "u1");
	const tries = [];
	for (let i = 0; i < 7; i++) tries.push(await app.getLoginChallengeUserId(env, token));
	return {
		tries,
		peek: await app.peekLoginChallengeUserId(env, token),
		consumed: await app.consumeLoginChallenge(env, token),
		afterConsume: await app.getLoginChallengeUserId(env, token),
	};
}

/**
 * Due and not-due events of every kind, with more recurring candidates than one page, so a run that stopped at
 * the first page would leave some unreminded.
 */
export async function reminderCandidates(app, env, { now, recurring = 620, pastOneOff = 620 }) {
	const db = app.createDb(env.DB);
	const { calendarEvents } = app.tables;
	await addUser(app, db, "u1");
	await addUser(app, db, "hidden", { calendarEnabled: false });
	const event = (id, values) => ({
		id,
		userId: "u1",
		title: id,
		startsAt: new Date(now.getTime() + 10 * MINUTE),
		endsAt: new Date(now.getTime() + 70 * MINUTE),
		reminderMinutes: 15,
		...values,
		...(values.startsAt ? { endsAt: new Date(values.startsAt.getTime() + HOUR) } : {}),
	});
	const rows = [
		event("one-off-due", {}),
		event("one-off-later", { startsAt: new Date(now.getTime() + 2 * HOUR) }),
		event("one-off-week-ahead", { startsAt: new Date(now.getTime() + 6 * DAY), reminderMinutes: 10080 }),
		event("one-off-no-reminder", { reminderMinutes: null }),
		event("one-off-hidden-calendar", { userId: "hidden" }),
		event("series-ended", { startsAt: new Date(now.getTime() - 10 * DAY + 10 * MINUTE), repeat: "daily", repeatUntil: new Date(now.getTime() - DAY) }),
	];
	for (let i = 0; i < pastOneOff; i++) rows.push(event(`past-${String(i).padStart(4, "0")}`, { startsAt: new Date(now.getTime() - (i + 1) * HOUR) }));
	// Daily series that started on different days, each with an occurrence ten minutes from now.
	for (let i = 0; i < recurring; i++) {
		rows.push(event(`series-${String(i).padStart(4, "0")}`, { startsAt: new Date(now.getTime() - (i % 30 + 1) * DAY + 10 * MINUTE), repeat: "daily" }));
	}
	for (let i = 0; i < rows.length; i += 50) await db.insert(calendarEvents).values(rows.slice(i, i + 50));

	const reminded = async () =>
		(await db.select({ id: calendarEvents.id, last: calendarEvents.lastRemindedStart }).from(calendarEvents))
			.filter((row) => row.last)
			.map((row) => row.id)
			.sort();
	await app.runCalendarReminders(env, now);
	const first = await reminded();
	const before = await db.select({ id: calendarEvents.id, last: calendarEvents.lastRemindedStart }).from(calendarEvents);
	await app.runCalendarReminders(env, new Date(now.getTime() + MINUTE));
	const after = await db.select({ id: calendarEvents.id, last: calendarEvents.lastRemindedStart }).from(calendarEvents);
	const lastById = new Map(before.map((row) => [row.id, row.last?.getTime() ?? null]));
	return {
		reminded: first.filter((id) => !id.startsWith("series-")),
		seriesReminded: first.filter((id) => id.startsWith("series-")).length,
		changedBySecondRun: after.filter((row) => (row.last?.getTime() ?? null) !== lastById.get(row.id)).map((row) => row.id),
	};
}
