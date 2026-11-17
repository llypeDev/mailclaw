import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
import { loadAppWithSqlite, seconds } from "./helpers/app-sqlite.mjs";

// src/lib/booking against a migrated SQLite database: free slots in the event's time zone (day
// boundaries, DST, the one-hour lead) minus every host's busy time, including recurring events,
// the all-or-nothing booking insert that refuses a taken slot, host validation, booking usernames,
// custom confirmations and the confirmation mail. Only sendEmail is stubbed; time is mocked.
const state = { sent: [], failSend: null };
globalThis.__bookingTest = state;
after(() => delete globalThis.__bookingTest);

const app = await loadAppWithSqlite({
	name: "booking",
	exports: [
		`export * from "./src/lib/booking/utils.ts";`,
		`export * from "./src/lib/booking/availability.ts";`,
		`export * from "./src/lib/booking/create.ts";`,
		`export * from "./src/lib/booking/hosts.ts";`,
		`export * from "./src/lib/booking/username.ts";`,
		`export * from "./src/lib/booking/confirmation-templates.ts";`,
		`export { sendBookingConfirmation } from "./src/lib/booking/confirmation.ts";`,
		`export { getDb } from "./src/db/index.ts";`,
	],
	mocks: {
		"@/lib/email/send": `
			export async function sendEmail(env, input) {
				if (globalThis.__bookingTest.failSend) throw globalThis.__bookingTest.failSend;
				globalThis.__bookingTest.sent.push(input);
				return { messageId: "msg_1", scheduled: true };
			}
		`,
	},
});
after(app.dispose);
const lib = app.lib;

/** Freezes Date at `iso` for the rest of the test. */
function freeze(t, iso) {
	mock.timers.enable({ apis: ["Date"], now: Date.parse(iso) });
	t.after(() => mock.timers.reset());
}

function bookingEvent(overrides = {}) {
	return {
		id: "be1",
		userId: "u1",
		name: "Intro",
		slug: "intro",
		description: "",
		color: "blue",
		hostIds: ["u1"],
		durationMinutes: 30,
		location: "Phone",
		weekdays: [2],
		startTime: "09:00",
		endTime: "10:00",
		timeRanges: [{ startTime: "09:00", endTime: "10:00" }],
		timeZone: "Europe/Berlin",
		enabled: true,
		...overrides,
	};
}

async function fixture(t) {
	state.sent = [];
	state.failSend = null;
	const database = await app.openDatabase(t);
	const sql = database.db;
	const env = { DB: database };
	const now = seconds(new Date());
	const addUser = (id, { email = `${id}@example.com`, disabled = false, calendarEnabled = true, bookingUsername = null } = {}) => {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, disabled, calendar_enabled, booking_username, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?, ?)")
			.run(id, email, id, disabled ? 1 : 0, calendarEnabled ? 1 : 0, bookingUsername, now);
	};
	let eventNumber = 0;
	const addCalendarEvent = (userId, startsAt, endsAt, { repeat = "none", timeZone = null, responseStatus = null, excluded = [], repeatUntil = null, repeatDays = [] } = {}) => {
		const id = `ce${++eventNumber}`;
		sql.prepare(
			"INSERT INTO calendar_events (id, user_id, title, repeat, repeat_days, repeat_until, excluded_occurrences, time_zone, starts_at, ends_at, response_status, created_at, updated_at) VALUES (?, ?, 'Busy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).run(id, userId, repeat, JSON.stringify(repeatDays), repeatUntil ? seconds(new Date(repeatUntil)) : null, JSON.stringify(excluded), timeZone, seconds(new Date(startsAt)), seconds(new Date(endsAt)), responseStatus, now, now);
		return id;
	};
	const events = (where = "1 = 1", ...params) => sql.prepare(`SELECT * FROM calendar_events WHERE ${where} ORDER BY user_id, starts_at`).all(...params);
	return { database, sql, env, now, addUser, addCalendarEvent, events };
}

const times = (slots) => slots.map((slot) => `${slot.localDate} ${slot.time}`);
const starts = (slots) => slots.map((slot) => slot.startsAt);

test("a local date and time become an instant in the event's zone, or nothing when invalid", () => {
	const berlin = bookingEvent();
	assert.deepEqual(lib.slotFromLocalDate(berlin, "2026-11-17", "09:30"), { startsAt: new Date("2026-11-17T08:30:00Z"), endsAt: new Date("2026-11-17T09:00:00Z") });
	// Summer time: the same wall clock is an hour earlier in UTC.
	assert.deepEqual(lib.slotFromLocalDate(berlin, "2026-07-14", "09:00").startsAt, new Date("2026-07-14T07:00:00Z"));
	for (const [date, time] of [["2026-11-18", "09:00"], ["2026-11-17", "08:45"], ["2026-11-17", "09:45"], ["2026-11-17", "09:10"], ["2026-02-30", "09:00"], ["2026-11-17", "9:00"], ["17.11.2026", "09:00"]]) {
		assert.equal(lib.slotFromLocalDate(berlin, date, time), null, `${date} ${time}`);
	}
	// 02:00-03:00 does not exist in New York on 8 March 2026.
	const newYork = bookingEvent({ timeZone: "America/New_York", weekdays: [0], timeRanges: [{ startTime: "01:00", endTime: "04:00" }] });
	assert.equal(lib.slotFromLocalDate(newYork, "2026-03-08", "02:30"), null);
	assert.deepEqual(lib.slotFromLocalDate(newYork, "2026-03-08", "01:30").startsAt, new Date("2026-03-08T06:30:00Z"));
	assert.deepEqual(lib.slotFromLocalDate(newYork, "2026-03-08", "03:00").startsAt, new Date("2026-03-08T07:00:00Z"));
});

test("event input is validated, ranges sorted and overlaps refused", () => {
	const valid = { name: " Café chat ", durationMinutes: 30, weekdays: [5, 1], timeRanges: [{ startTime: "13:00", endTime: "15:00" }, { startTime: "09:00", endTime: "10:00" }], timeZone: "Europe/Berlin", enabled: true };
	const parsed = lib.parseBookingEventInput(valid);
	assert.equal(parsed.name, "Café chat");
	assert.equal(parsed.slug, "cafe-chat");
	assert.deepEqual(parsed.weekdays, [1, 5]);
	assert.deepEqual(parsed.timeRanges.map((range) => range.startTime), ["09:00", "13:00"]);
	assert.deepEqual([parsed.startTime, parsed.endTime], ["09:00", "10:00"]);
	assert.deepEqual(parsed.hostIds, []);
	for (const change of [
		{ timeRanges: [{ startTime: "09:00", endTime: "11:00" }, { startTime: "10:30", endTime: "12:00" }] },
		{ timeRanges: [{ startTime: "09:00", endTime: "09:15" }] },
		{ timeRanges: [{ startTime: "09:10", endTime: "10:00" }] },
		{ timeZone: "Mars/Olympus" },
		{ weekdays: [1, 1] },
		{ weekdays: [] },
		{ durationMinutes: 4 },
		{ hostIds: ["u2", "u2"] },
		{ slug: "Not A Slug" },
	]) assert.equal(lib.parseBookingEventInput({ ...valid, ...change }), null, JSON.stringify(change));
	assert.deepEqual(lib.parseBookingTimeRanges("nope", { startTime: "08:00", endTime: "12:00" }), [{ startTime: "08:00", endTime: "12:00" }]);
	assert.deepEqual(lib.parseBookingWeekdays("[1, 7, 3, \"2\"]"), [1, 3]);
});

test("free slots follow the event's time zone and skip a host's busy time", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	f.addUser("u1");
	const event = bookingEvent();
	let slots = await lib.availableBookingSlots(f.env, event, 7);
	assert.deepEqual(times(slots), ["2026-11-17 09:00", "2026-11-17 09:15", "2026-11-17 09:30"]);
	assert.deepEqual(slots[0], { startsAt: "2026-11-17T08:00:00.000Z", endsAt: "2026-11-17T08:30:00.000Z", localDate: "2026-11-17", time: "09:00" });

	// Ends exactly when the first slot starts: no conflict.
	f.addCalendarEvent("u1", "2026-11-17T07:30:00Z", "2026-11-17T08:00:00Z");
	assert.equal((await lib.availableBookingSlots(f.env, event, 7)).length, 3);
	f.addCalendarEvent("u1", "2026-11-17T08:10:00Z", "2026-11-17T08:20:00Z");
	slots = await lib.availableBookingSlots(f.env, event, 7);
	assert.deepEqual(times(slots), ["2026-11-17 09:30"]);
});

test("every host's calendar counts; unanswered invitations and other users' do not", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	for (const id of ["u1", "u2", "u3"]) f.addUser(id);
	const event = bookingEvent({ hostIds: ["u1", "u2"] });
	f.addCalendarEvent("u3", "2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z");
	f.addCalendarEvent("u1", "2026-11-17T08:00:00Z", "2026-11-17T09:00:00Z", { responseStatus: "needs-action" });
	assert.equal((await lib.availableBookingSlots(f.env, event, 7)).length, 3);
	f.addCalendarEvent("u2", "2026-11-17T08:30:00Z", "2026-11-17T08:45:00Z", { responseStatus: "tentative" });
	assert.deepEqual(times(await lib.availableBookingSlots(f.env, event, 7)), ["2026-11-17 09:00"]);
});

test("recurring events block by wall-clock time, honour exclusions and their end", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	f.addUser("u1");
	const event = bookingEvent();
	// Weekly on Tuesdays at 09:00 Berlin time, created in summer time (07:00Z). After the clocks went
	// back on 25 October the occurrence on 17 November is at 08:00Z, still 09:00 on the wall.
	const weekly = f.addCalendarEvent("u1", "2026-10-20T07:00:00Z", "2026-10-20T07:30:00Z", { repeat: "weekly", timeZone: "Europe/Berlin" });
	assert.deepEqual(times(await lib.availableBookingSlots(f.env, event, 7)), ["2026-11-17 09:30"]);

	f.sql.prepare("UPDATE calendar_events SET excluded_occurrences = ? WHERE id = ?").run(JSON.stringify([Date.parse("2026-11-17T08:00:00Z")]), weekly);
	assert.equal((await lib.availableBookingSlots(f.env, event, 7)).length, 3, "that week's occurrence was removed");

	f.sql.prepare("UPDATE calendar_events SET excluded_occurrences = '[]', repeat_until = ? WHERE id = ?").run(seconds(new Date("2026-11-10T12:00:00Z")), weekly);
	assert.equal((await lib.availableBookingSlots(f.env, event, 7)).length, 3, "the series ended the week before");

	f.addCalendarEvent("u1", "2026-11-05T08:15:00Z", "2026-11-05T08:30:00Z", { repeat: "weekdays", repeatDays: [2], timeZone: "Europe/Berlin" });
	assert.deepEqual(times(await lib.availableBookingSlots(f.env, event, 7)), ["2026-11-17 09:30"]);
});

test("the local day is the event's, slots need an hour's notice, and DST gaps are skipped", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	// 12:00Z on Monday is already 01:00 on Tuesday in Auckland (UTC+13).
	const auckland = bookingEvent({ timeZone: "Pacific/Auckland", timeRanges: [{ startTime: "09:00", endTime: "09:30" }] });
	mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-16T12:00:00Z") });
	t.after(() => mock.timers.reset());
	assert.deepEqual(starts(await lib.availableBookingSlots(f.env, auckland, 1)), ["2026-11-16T20:00:00.000Z"]);
	mock.timers.setTime(Date.parse("2026-11-16T18:59:00Z"));
	assert.equal((await lib.availableBookingSlots(f.env, auckland, 1)).length, 1);
	mock.timers.setTime(Date.parse("2026-11-16T19:01:00Z"));
	assert.equal((await lib.availableBookingSlots(f.env, auckland, 1)).length, 0, "less than an hour away");

	mock.timers.setTime(Date.parse("2026-03-07T00:00:00Z"));
	const newYork = bookingEvent({ timeZone: "America/New_York", weekdays: [0], timeRanges: [{ startTime: "01:00", endTime: "04:00" }], durationMinutes: 60 });
	const slots = await lib.availableBookingSlots(f.env, newYork, 3);
	assert.deepEqual(slots.map((slot) => slot.time), ["01:00", "01:15", "01:30", "01:45", "03:00"], "no slot starts in the missing hour");
	assert.deepEqual([slots[3].startsAt, slots[3].endsAt, slots[4].startsAt], ["2026-03-08T06:45:00.000Z", "2026-03-08T07:45:00.000Z", "2026-03-08T07:00:00.000Z"]);
});

test("a booking inserts one event per host, all or nothing, and never twice for a slot", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	for (const id of ["u1", "u2"]) f.addUser(id);
	const event = bookingEvent({ hostIds: ["u1", "u2"] });
	const book = (guest, startsAt, endsAt) => lib.createBookedCalendarEvents(f.env, event, guest, `${guest.toLowerCase()}@example.org`, startsAt, endsAt, ["bob@example.org"], "About pricing");

	assert.equal(await book("Ana", "2026-11-17T08:30:00.000Z", "2026-11-17T09:00:00.000Z"), true);
	const booked = f.events();
	assert.deepEqual(booked.map((row) => row.user_id), ["u1", "u2"]);
	assert.notEqual(booked[0].id, booked[1].id);
	for (const row of booked) {
		assert.equal(row.title, "Intro with Ana");
		assert.equal(row.description, "Booked by Ana (ana@example.org)\n\nAbout pricing");
		assert.deepEqual(JSON.parse(row.attendees), ["ana@example.org", "bob@example.org"]);
		assert.deepEqual([row.repeat, row.time_zone, row.location, row.starts_at, row.ends_at], ["none", "Europe/Berlin", "Phone", seconds(new Date("2026-11-17T08:30:00Z")), seconds(new Date("2026-11-17T09:00:00Z"))]);
	}
	assert.deepEqual(times(await lib.availableBookingSlots(f.env, event, 7)), ["2026-11-17 09:00"], "the booked slot and the overlapping one are gone");

	assert.equal(await book("Eve", "2026-11-17T08:30:00.000Z", "2026-11-17T09:00:00.000Z"), false);
	assert.equal(await book("Eve", "2026-11-17T08:45:00.000Z", "2026-11-17T09:15:00.000Z"), false);
	assert.equal(f.events().length, 2);
	assert.equal(await book("Eve", "2026-11-17T09:00:00.000Z", "2026-11-17T09:30:00.000Z"), true, "back to back is fine");

	// Only u2 is busy: nobody is booked, not even u1.
	f.addCalendarEvent("u2", "2026-11-17T10:00:00Z", "2026-11-17T11:00:00Z");
	assert.equal(await book("Zoe", "2026-11-17T10:00:00.000Z", "2026-11-17T10:30:00.000Z"), false);
	assert.equal(f.events("title = 'Intro with Zoe'").length, 0);

	// Two guests racing for the same slot: one wins, and each host gets exactly one event.
	const raced = await Promise.all([book("Max", "2026-11-17T12:00:00.000Z", "2026-11-17T12:30:00.000Z"), book("Mia", "2026-11-17T12:00:00.000Z", "2026-11-17T12:30:00.000Z")]);
	assert.deepEqual(raced.sort(), [false, true]);
	assert.equal(f.events("starts_at = ?", seconds(new Date("2026-11-17T12:00:00Z"))).length, 2);
});

test("an unanswered invitation shown as free can also be booked", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	f.addUser("u1");
	const event = bookingEvent();
	f.addCalendarEvent("u1", "2026-11-17T08:00:00Z", "2026-11-17T08:30:00Z", { responseStatus: "needs-action" });
	const [slot] = await lib.availableBookingSlots(f.env, event, 7);
	assert.equal(slot.startsAt, "2026-11-17T08:00:00.000Z", "offered to the guest");
	assert.equal(await lib.createBookedCalendarEvents(f.env, event, "Ana", "ana@example.org", slot.startsAt, slot.endsAt), true, "and bookable");
});

test("hosts: the owner always leads, and every host must be an active calendar user", async (t) => {
	assert.deepEqual(lib.parseBookingHostIds(JSON.stringify(["u2", "u1", "u3"]), "u1"), ["u1", "u2", "u3"]);
	for (const value of ["[]", "not json", JSON.stringify(["u2", "u2"]), JSON.stringify(["u2", ""]), JSON.stringify({ u2: true })]) {
		assert.deepEqual(lib.parseBookingHostIds(value, "u1"), ["u1"], value);
	}

	const f = await fixture(t);
	f.addUser("u1");
	f.addUser("u2");
	f.addUser("off", { disabled: true });
	f.addUser("nocal", { calendarEnabled: false });
	const db = lib.getDb(f.env);
	assert.deepEqual(await lib.validBookingHostIds(db, "u1", [], false), ["u1"]);
	assert.deepEqual(await lib.validBookingHostIds(db, "u1", ["u1", "u2"], true), ["u1", "u2"]);
	assert.equal(await lib.validBookingHostIds(db, "u1", ["u2"], false), null, "adding hosts needs permission");
	assert.equal(await lib.validBookingHostIds(db, "u1", ["off"], true), null);
	assert.equal(await lib.validBookingHostIds(db, "u1", ["nocal"], true), null);
	assert.equal(await lib.validBookingHostIds(db, "u1", ["ghost"], true), null);
	assert.equal(await lib.validBookingHostIds(db, "u1", Array.from({ length: 20 }, (_, index) => `h${index}`), true), null, "more than 20 hosts");
});

test("booking usernames come from the address and step past ones in use", async (t) => {
	const f = await fixture(t);
	f.addUser("a", { email: "Ána.María@example.com" });
	f.addUser("b", { email: "ana.maria@other.org" });
	f.addUser("c", { email: "x@example.com", bookingUsername: "chosen" });
	assert.equal(await lib.ensureBookingUsername(f.env, "a", "Ána.María@example.com"), "ana.maria");
	assert.equal(await lib.ensureBookingUsername(f.env, "b", "ana.maria@other.org"), "ana.maria2");
	assert.equal(await lib.ensureBookingUsername(f.env, "a", "changed@example.com"), "ana.maria", "kept once assigned");
	assert.equal(await lib.ensureBookingUsername(f.env, "c", "x@example.com"), "chosen");
	await assert.rejects(lib.ensureBookingUsername(f.env, "nobody", "n@example.com"), /User not found/);
	assert.equal(lib.bookingUsernameFromEmail("!!!@example.com"), "user");
	assert.equal(lib.normalizeBookingUsername("ana b"), null);
	assert.equal(lib.normalizeBookingUsername("._-"), null);
	assert.equal(lib.normalizeBookingUsername(" Ana.B "), "ana.b");
});

test("custom confirmations are saved, cleared and missing before their migration", async (t) => {
	const f = await fixture(t);
	f.addUser("u1");
	f.sql.prepare("INSERT INTO booking_events (id, user_id, name, slug, duration_minutes, created_at, updated_at) VALUES ('be1', 'u1', 'Intro', 'intro', 30, ?, ?), ('be2', 'u1', 'Demo', 'demo', 30, ?, ?)").run(f.now, f.now, f.now, f.now);
	const db = lib.getDb(f.env);
	await lib.saveConfirmationTemplate(db, "be1", { subject: "See you {when}", body: "" });
	await lib.saveConfirmationTemplate(db, "be1", { subject: "See you, {guestName}", body: "Bring coffee" });
	assert.deepEqual([...(await lib.getConfirmationTemplates(db, ["be1", "be2"])).entries()], [["be1", { subject: "See you, {guestName}", body: "Bring coffee" }]]);
	assert.deepEqual(
		(await lib.withConfirmationTemplates(db, [{ id: "be1" }, { id: "be2" }])).map((event) => [event.id, event.confirmationSubject, event.confirmationBody]),
		[["be1", "See you, {guestName}", "Bring coffee"], ["be2", "", ""]],
	);
	await lib.saveConfirmationTemplate(db, "be1", { subject: "", body: "" });
	assert.equal((await lib.getConfirmationTemplates(db, ["be1"])).size, 0);
	assert.equal((await lib.getConfirmationTemplates(db, [])).size, 0);

	f.sql.exec("DROP TABLE booking_confirmation_templates");
	assert.equal((await lib.getConfirmationTemplates(db, ["be1"])).size, 0);
	await lib.saveConfirmationTemplate(db, "be1", { subject: "", body: "" });
	await assert.rejects(lib.saveConfirmationTemplate(db, "be1", { subject: "Hi", body: "" }), lib.ConfirmationTemplatesUnavailableError);
});

test("the confirmation goes from the owner's own mailbox, five seconds later, with an invite", async (t) => {
	freeze(t, "2026-11-16T00:00:00Z");
	const f = await fixture(t);
	f.addUser("u1", { email: "Paul@Example.com" });
	f.sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(f.now);
	const addMailbox = (id, localPart, createdAt, { type = "personal", disabled = false } = {}) =>
		f.sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES (?, 'u1', 'd1', ?, ?, ?, ?)").run(id, localPart, type, disabled ? 1 : 0, createdAt);
	f.sql.prepare("INSERT INTO booking_events (id, user_id, name, slug, duration_minutes, created_at, updated_at) VALUES ('be1', 'u1', 'Intro', 'intro', 30, ?, ?)").run(f.now, f.now);
	const event = bookingEvent();
	const input = { event, hostName: "Paul", guestName: "Ana", guestEmail: "ana@example.org", notes: "", startsAt: "2026-11-17T08:00:00.000Z", endsAt: "2026-11-17T08:30:00.000Z", locale: "en-GB", publicOrigin: "https://mail.example.com" };
	const warn = t.mock.method(console, "warn", () => {});
	const error = t.mock.method(console, "error", () => {});

	assert.equal(await lib.sendBookingConfirmation(f.env, input), false, "no personal mailbox yet");
	addMailbox("shared", "team", f.now - 300, { type: "shared" });
	addMailbox("off", "old", f.now - 200, { disabled: true });
	assert.equal(await lib.sendBookingConfirmation(f.env, input), false);
	assert.equal(warn.mock.callCount(), 2);
	assert.equal(state.sent.length, 0);

	addMailbox("info", "info", f.now - 100);
	assert.equal(await lib.sendBookingConfirmation(f.env, input), true);
	assert.equal(state.sent.at(-1).from, "info@example.com", "the oldest personal mailbox when none matches the account");
	addMailbox("own", "paul", f.now);
	assert.equal(await lib.sendBookingConfirmation(f.env, input), true);
	const mail = state.sent.at(-1);
	assert.deepEqual([mail.userId, mail.mailboxId, mail.from, mail.to, mail.subject, mail.publicOrigin], ["u1", "own", "paul@example.com", "ana@example.org", "Confirmed: Intro with Paul", "https://mail.example.com"]);
	assert.match(mail.text, /^Hi Ana,\n\nyour booking is confirmed: Intro with Paul\.\n\nWhen: Tuesday,? 17 November 2026, 09:00–09:30 \(Europe\/Berlin\)/);
	assert.equal(mail.scheduledAt.toISOString(), "2026-11-16T00:00:05.000Z");
	assert.equal(mail.attachments.length, 1);
	assert.equal(mail.attachments[0].filename, "invite.ics");
	const ics = new TextDecoder().decode(mail.attachments[0].content);
	assert.match(ics, /\r\nDTSTART:20261117T080000Z\r\nDTEND:20261117T083000Z\r\n/);
	assert.match(ics, /\r\nSUMMARY:Intro \(Paul\)\r\n/);
	assert.ok(!state.sent.some((sent) => /bob@/.test(sent.to)), "added guests are never mailed");

	await lib.saveConfirmationTemplate(lib.getDb(f.env), "be1", { subject: "See you, {guestName}", body: "" });
	await lib.sendBookingConfirmation(f.env, input);
	assert.equal(state.sent.at(-1).subject, "See you, Ana");

	state.failSend = new Error("queue down");
	assert.equal(await lib.sendBookingConfirmation(f.env, input), false, "a failed send never fails the booking");
	assert.equal(error.mock.callCount(), 1);
});
