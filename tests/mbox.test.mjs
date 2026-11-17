import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite, recordingBucket, seconds } from "./helpers/app-sqlite.mjs";

// mbox in both directions: splitMboxMessages (src/lib/import/mbox.ts) cuts a file on From_ lines and
// undoes >From quoting, exportMailboxToMbox (src/lib/export/mbox.ts) writes a mailbox from a migrated
// SQLite database, and an exported file imported into another mailbox keeps its messages and threads.
const app = await loadAppWithSqlite({
	name: "mbox",
	exports: [
		`export { splitMboxMessages } from "./src/lib/import/mbox.ts";`,
		`export { exportMailboxToMbox } from "./src/lib/export/mbox.ts";`,
		`export { importMessagesToMailbox } from "./src/lib/import/service.ts";`,
		`export { parseRawMime } from "./src/lib/email/parse.ts";`,
	],
});
after(app.dispose);
const lib = app.lib;

test("an mbox is split on From_ lines, with CRLF and LF alike", () => {
	const mbox = [
		"From alice@example.org Mon Nov 16 10:00:00 2026",
		"Subject: one",
		"",
		"first body",
		"",
		"From bob@example.org Mon Nov 16 11:00:00 2026",
		"Subject: two",
		"",
		"second body",
		"",
	];
	const expected = ["Subject: one\n\nfirst body", "Subject: two\n\nsecond body"];
	assert.deepEqual(lib.splitMboxMessages(mbox.join("\n")), expected);
	assert.deepEqual(lib.splitMboxMessages(mbox.join("\r\n")), expected, "CRLF is normalised to LF");
	// One trailing line break is the separator before the next From_ line; the rest stays.
	assert.deepEqual(lib.splitMboxMessages("From a\nSubject: x\n\nbody\n\n\nFrom b\nSubject: y\n\nz"), ["Subject: x\n\nbody\n", "Subject: y\n\nz"]);
});

test("text before the first From_ line counts as a message, and empty messages are dropped", () => {
	assert.deepEqual(lib.splitMboxMessages("Subject: bare\n\nno separator"), ["Subject: bare\n\nno separator"]);
	assert.deepEqual(lib.splitMboxMessages(""), []);
	assert.deepEqual(lib.splitMboxMessages("From a\n\n\nFrom b\n   \nFrom c\nSubject: c\n"), ["Subject: c"]);
	// Only a line that starts with "From " splits; "From:" headers and indented text do not.
	assert.deepEqual(lib.splitMboxMessages("From a\nFrom: x@example.org\n\n From here\nFromage\n"), ["From: x@example.org\n\n From here\nFromage"]);
});

test(">From quoting in a body is undone on import", () => {
	const [message] = lib.splitMboxMessages("From a\nSubject: q\n\nhello\n>From the start\n>>From deeper\n");
	// mboxrd: one `>` comes off each quoted From line, however deep.
	assert.equal(message, "Subject: q\n\nhello\nFrom the start\n>From deeper");
});

async function fixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	const now = seconds(new Date());
	sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'kevin@example.com', 'Kevin', 'x', ?)").run(now);
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'u1', 'example.com', 'zone', ?)").run(now);
	for (const id of ["mb1", "mb2", "empty"]) {
		sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, created_at) VALUES (?, 'u1', 'd1', ?, ?)").run(id, id, now);
	}
	const env = { DB: database, BUCKET: recordingBucket() };
	const addMessage = (id, values) => {
		const row = {
			mailbox_id: "mb1",
			direction: "inbound",
			from_addr: "Anna <anna@example.org>",
			to_addr: "kevin@example.com",
			status: "received",
			...values,
			id,
			user_id: "u1",
		};
		const columns = Object.keys(row);
		sql.prepare(`INSERT INTO messages (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
	};
	return { sql, env, addMessage };
}

const at = (iso) => seconds(new Date(iso));

test("a mailbox is exported oldest first with its headers, and a From_ line in a body is quoted", async (t) => {
	const f = await fixture(t);
	f.addMessage("m2", {
		provider_message_id: "<reply@example.com>",
		direction: "outbound",
		status: "sent",
		from_addr: "kevin@example.com",
		to_addr: "Anna <anna@example.org>",
		cc_addr: "carl@example.org,\r\n dana@example.org",
		subject: "Re: Plans\nfor Friday",
		in_reply_to: "plans@example.org",
		references_header: "root@example.org  plans@example.org",
		text_body: "Sounds good.\nFrom now on, Fridays.",
		created_at: at("2026-11-16T11:00:00Z"),
	});
	f.addMessage("m1", {
		provider_message_id: "<plans@example.org>",
		subject: "Plans",
		html_body: "<p>Friday?</p>",
		text_body: "Friday?",
		created_at: at("2026-11-16T10:00:00Z"),
	});
	f.addMessage("m3", { subject: null, created_at: at("2026-11-16T12:00:00Z") });
	f.addMessage("other", { mailbox_id: "mb2", subject: "Elsewhere", created_at: at("2026-11-16T09:00:00Z") });

	const mbox = await lib.exportMailboxToMbox(f.env, "mb1");
	const lines = mbox.split("\r\n");
	assert.equal(lines.filter((line) => line.startsWith("From ")).length, 3);
	assert.equal(lines[0], "From MAILER-DAEMON Mon, 16 Nov 2026 10:00:00 GMT");
	assert.ok(!mbox.includes("Elsewhere"), "only the chosen mailbox");

	const [first, second, third] = mbox.split(/\r\n(?=From MAILER-DAEMON )/);
	assert.equal(first, [
		"From MAILER-DAEMON Mon, 16 Nov 2026 10:00:00 GMT",
		"Message-ID: <plans@example.org>",
		"Date: Mon, 16 Nov 2026 10:00:00 GMT",
		"From: Anna <anna@example.org>",
		"To: kevin@example.com",
		"Subject: Plans",
		"X-Mailclaw-Direction: inbound",
		"X-Mailclaw-Status: received",
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=utf-8",
		"Content-Transfer-Encoding: 8bit",
		"",
		"<p>Friday?</p>",
		"",
	].join("\r\n"), "HTML wins over text");
	assert.ok(second.includes("\r\nCc: carl@example.org,  dana@example.org\r\n"), "header line breaks are flattened");
	assert.ok(second.includes("\r\nSubject: Re: Plans for Friday\r\n"));
	assert.ok(second.includes("\r\nIn-Reply-To: <plans@example.org>\r\n"));
	assert.ok(second.includes("\r\nReferences: <root@example.org> <plans@example.org>\r\n"));
	assert.ok(second.includes("\r\nContent-Type: text/plain; charset=utf-8\r\n"));
	assert.ok(second.includes("Sounds good.\n>From now on, Fridays."), "a body line starting with From is quoted");
	assert.ok(third.includes("\r\nMessage-ID: <m3@mailclaw.local>\r\n"), "a message without a provider id gets a stable one");
	assert.ok(third.includes("\r\nSubject: \r\n"));

	assert.equal(await lib.exportMailboxToMbox(f.env, "empty"), "");
});

test("an exported mailbox imports back with the same messages, bodies and thread", async (t) => {
	const f = await fixture(t);
	f.addMessage("m1", {
		provider_message_id: "<plans@example.org>",
		subject: "Plans",
		text_body: "Friday?\nFrom my phone",
		created_at: at("2026-11-16T10:00:00Z"),
	});
	f.addMessage("m2", {
		provider_message_id: "<reply@example.org>",
		from_addr: "Bea <bea@example.org>",
		subject: "Re: Plans",
		in_reply_to: "plans@example.org",
		references_header: "plans@example.org",
		text_body: "Yes",
		created_at: at("2026-11-16T11:00:00Z"),
	});

	const parts = lib.splitMboxMessages(await lib.exportMailboxToMbox(f.env, "mb1"));
	assert.equal(parts.length, 2);
	const parsed = await lib.parseRawMime(new TextEncoder().encode(parts[0]).buffer);
	assert.equal(parsed.text.trim(), "Friday?\nFrom my phone", "the quoted From line comes back unquoted");

	const result = await lib.importMessagesToMailbox(f.env, {
		userId: "u1",
		mailboxId: "mb2",
		destination: { type: "system", section: "inbox" },
		messages: parts.map((part, index) => ({ filename: `mb1.mbox#${index + 1}`, raw: new TextEncoder().encode(part).buffer })),
	});
	assert.deepEqual(result, { imported: 2, skipped: 0, errors: [] });

	const rows = f.sql.prepare("SELECT provider_message_id, from_addr, subject, text_body, thread_id, in_reply_to, created_at FROM messages WHERE mailbox_id = 'mb2' ORDER BY created_at").all();
	assert.deepEqual(rows.map((row) => [row.provider_message_id, row.subject, row.text_body.trim(), row.created_at]), [
		["<plans@example.org>", "Plans", "Friday?\nFrom my phone", at("2026-11-16T10:00:00Z")],
		["<reply@example.org>", "Re: Plans", "Yes", at("2026-11-16T11:00:00Z")],
	]);
	assert.equal(rows[1].in_reply_to, "plans@example.org");
	assert.equal(rows[1].thread_id, rows[0].thread_id, "the reply joins the original's thread");
	assert.match(rows[1].from_addr, /bea@example\.org/);

	// Importing the same export again finds every message by its Message-ID.
	const again = await lib.importMessagesToMailbox(f.env, {
		userId: "u1",
		mailboxId: "mb2",
		destination: { type: "system", section: "inbox" },
		messages: parts.map((part, index) => ({ filename: `mb1.mbox#${index + 1}`, raw: new TextEncoder().encode(part).buffer })),
	});
	assert.deepEqual(again, { imported: 0, skipped: 2, errors: [] });
});

// Bug: escapeMboxBody (src/lib/export/mbox.ts:9-11) quotes "\nFrom " only, so a body whose very first
// line starts with "From " is written unquoted after the blank header separator, and the importer
// (or any mbox reader) cuts the message there. Exporting one message whose text body is
// "From the desk of Anna" yields two messages on import instead of one.
test("a body that starts with a From line survives the round trip (src/lib/export/mbox.ts escapeMboxBody)", async (t) => {
	const f = await fixture(t);
	f.addMessage("m1", { provider_message_id: "<desk@example.org>", subject: "Memo", text_body: "From the desk of Anna\nHello", created_at: at("2026-11-16T10:00:00Z") });
	const parts = lib.splitMboxMessages(await lib.exportMailboxToMbox(f.env, "mb1"));
	assert.equal(parts.length, 1);
	assert.ok(parts[0].endsWith("From the desk of Anna\nHello"));
});

// Bug: the export writes mboxo quoting (only "From " gains a ">") while the import strips one ">" from
// every ">From " line (src/lib/import/mbox.ts:7-9). A body line that already read ">From x" (a quoted
// reply) comes back as "From x". mboxrd quoting on export (/^>*From / gains a ">") would make the
// round trip lossless with the current importer.
test("a body line that already starts with >From survives the round trip (mboxrd quoting)", async (t) => {
	const f = await fixture(t);
	f.addMessage("m1", { provider_message_id: "<q@example.org>", subject: "Quote", text_body: "Hi\n>From the old thread", created_at: at("2026-11-16T10:00:00Z") });
	const [part] = lib.splitMboxMessages(await lib.exportMailboxToMbox(f.env, "mb1"));
	assert.ok(part.endsWith("Hi\n>From the old thread"));
});
