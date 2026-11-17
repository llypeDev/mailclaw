import assert from "node:assert/strict";
import test, { after } from "node:test";
import { loadAppWithSqlite } from "./helpers/app-sqlite.mjs";

// Realtime delivery: the browser-side helpers in src/hooks/message-realtime-utils.ts (reconnect
// backoff, socket URL, event parsing, the desktop notification), src/lib/realtime/utils.ts (session
// cookie, who is notified for a mailbox, fan-out to hubs and push), the mail revision a socket
// compares against (real SQLite and its revision triggers), and the RealtimeHub Durable Object
// with a stubbed state and sockets. Push senders and cloudflare:workers are stubbed.
const state = { pushes: [], native: [], hasPush: false, pushError: null };
globalThis.__realtimeTest = state;
after(() => delete globalThis.__realtimeTest);

const app = await loadAppWithSqlite({
	name: "realtime",
	exports: [
		`export * from "./src/hooks/message-realtime-utils.ts";`,
		`export * from "./src/lib/realtime/utils.ts";`,
		`export { getUserMailRevision } from "./src/lib/realtime/revision.ts";`,
		`export { RealtimeHub } from "./src/lib/realtime/hub.ts";`,
	],
	mocks: {
		"cloudflare:workers": "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
		"@/lib/push/client": `export async function hasActivePushSubscription() {
			if (globalThis.__realtimeTest.pushError) throw globalThis.__realtimeTest.pushError;
			return globalThis.__realtimeTest.hasPush;
		}`,
		"@/lib/push/server": "export async function sendPushNotifications(env, userIds, payload) { globalThis.__realtimeTest.pushes.push({ userIds, payload }); }",
		"@/lib/push/native": "export async function sendNativePush(env, userIds, payload) { globalThis.__realtimeTest.native.push({ userIds, payload }); }",
	},
});
after(app.dispose);
const lib = app.lib;

/** Installs window/document/Notification stand-ins for one test. */
function browser(t, { protocol = "https:", storage = {}, permission = "granted", visibility = "hidden", storageThrows = false } = {}) {
	const page = { focused: 0, assigned: [], notifications: [], storage: { ...storage } };
	const localStorage = {
		getItem(key) { if (storageThrows) throw new Error("denied"); return key in page.storage ? page.storage[key] : null; },
		setItem(key, value) { page.storage[key] = value; },
	};
	class FakeNotification {
		static permission = permission;
		constructor(title, options) {
			if (page.notificationError) throw page.notificationError;
			this.title = title;
			this.options = options;
			this.closed = false;
			page.notifications.push(this);
		}
		close() { this.closed = true; }
	}
	const saved = { window: globalThis.window, document: globalThis.document, Notification: globalThis.Notification };
	globalThis.window = { localStorage, location: { protocol, host: "mail.example.com", assign: (url) => page.assigned.push(url) }, focus: () => { page.focused += 1; } };
	globalThis.document = { visibilityState: visibility };
	globalThis.Notification = FakeNotification;
	t.after(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
		state.hasPush = false;
		state.pushError = null;
	});
	return page;
}

const event = { type: "new_message", messageId: "msg-1", mailboxId: "mb-1", from: "\"Anna\" <anna@example.org>", fromName: "Anna", subject: "Lunch?" };

test("reconnects back off exponentially up to 30 seconds", () => {
	assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map(lib.getReconnectDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
	assert.equal(lib.REALTIME_RECONNECT_MAX_MS, 30000);
});

test("the socket URL follows the page's scheme and host", (t) => {
	browser(t, { protocol: "https:" });
	assert.equal(lib.getRealtimeWebSocketUrl(), "wss://mail.example.com/api/realtime");
	globalThis.window.location.protocol = "http:";
	assert.equal(lib.getRealtimeWebSocketUrl(), "ws://mail.example.com/api/realtime");
});

test("browser notifications are on unless turned off, even when storage is blocked", (t) => {
	const page = browser(t);
	assert.equal(lib.areBrowserNotificationsEnabled(), true);
	lib.setBrowserNotificationsEnabled(false);
	assert.deepEqual(page.storage, { "mailclaw:browser-notifications-enabled": "false" });
	assert.equal(lib.areBrowserNotificationsEnabled(), false);
	lib.setBrowserNotificationsEnabled(true);
	assert.equal(lib.areBrowserNotificationsEnabled(), true);
});

test("blocked storage keeps notifications on", (t) => {
	browser(t, { storageThrows: true });
	assert.equal(lib.areBrowserNotificationsEnabled(), true);
});

test("only well-formed new-message events are accepted, with unknown fields dropped", () => {
	assert.deepEqual(lib.parseNewMessageEvent(JSON.stringify({ ...event, extra: "x" })), event);
	assert.deepEqual(lib.parseNewMessageEvent(JSON.stringify({ ...event, fromName: 7, subject: null })), { ...event, fromName: null, subject: null });
	for (const value of [
		"not json",
		JSON.stringify({ ...event, type: "agent_draft" }),
		JSON.stringify({ ...event, messageId: 1 }),
		JSON.stringify({ ...event, mailboxId: undefined }),
		JSON.stringify({ ...event, from: null }),
		"null",
	]) {
		assert.equal(lib.parseNewMessageEvent(value), null, value);
	}
});

test("a hidden tab shows a desktop notification that opens the message", async (t) => {
	const page = browser(t);
	await lib.showBrowserNewMessageNotification(event);
	assert.equal(page.notifications.length, 1);
	const [notification] = page.notifications;
	assert.equal(notification.title, "Lunch?");
	assert.deepEqual(notification.options, { body: "From Anna <anna@example.org>", icon: "/icon-96.png", tag: "msg-1" });
	notification.onclick();
	assert.equal(page.focused, 1);
	assert.deepEqual(page.assigned, ["/inbox/msg-1"]);
	assert.equal(notification.closed, true);

	await lib.showBrowserNewMessageNotification({ ...event, subject: null, fromName: null });
	assert.equal(page.notifications[1].title, "New email");
	assert.equal(page.notifications[1].options.body, "From anna@example.org");
});

test("no desktop notification without permission, in a visible tab, when turned off, or with Web Push active", async (t) => {
	for (const options of [{ permission: "default" }, { permission: "denied" }, { visibility: "visible" }, { storage: { "mailclaw:browser-notifications-enabled": "false" } }]) {
		await t.test(JSON.stringify(options), async (t) => {
			const page = browser(t, options);
			await lib.showBrowserNewMessageNotification(event);
			assert.equal(page.notifications.length, 0);
		});
	}
	await t.test("push subscription", async (t) => {
		const page = browser(t);
		state.hasPush = true;
		await lib.showBrowserNewMessageNotification(event);
		assert.equal(page.notifications.length, 0, "the service worker shows it instead");
	});
	await t.test("push check fails", async (t) => {
		const page = browser(t);
		state.pushError = new Error("no service worker");
		await lib.showBrowserNewMessageNotification(event);
		assert.equal(page.notifications.length, 1);
	});
	await t.test("constructor throws", async (t) => {
		const page = browser(t);
		page.notificationError = new TypeError("Illegal constructor");
		await lib.showBrowserNewMessageNotification(event);
		assert.equal(page.notifications.length, 0);
	});
});

test("the session token is read from the ep_session cookie only", () => {
	const token = (cookie) => lib.getSessionTokenFromRequest(new Request("https://mail.example.com/api/realtime", { headers: cookie === undefined ? {} : { Cookie: cookie } }));
	assert.equal(token("a=1; ep_session=abc%3D%3D; b=2"), "abc==");
	assert.equal(token("ep_session=x=y"), "x=y");
	assert.equal(token(undefined), undefined);
	assert.equal(token("ep_session="), undefined);
	assert.equal(token("xep_session=1; ep_sessions=2"), undefined);
});

async function mailFixture(t) {
	const database = await app.openDatabase(t);
	const sql = database.db;
	for (const id of ["admin", "u1", "u2", "u3"]) {
		sql.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, 'x', 0)").run(id, `${id}@example.com`, id);
	}
	sql.prepare("INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('d1', 'admin', 'example.com', 'zone', 0)").run();
	const addMailbox = (id, userId, type = "personal", disabled = false) => sql.prepare("INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES (?, ?, 'd1', ?, ?, ?, 0)").run(id, userId, id, type, disabled ? 1 : 0);
	const grant = (mailboxId, userId, permission = "read_only") => sql.prepare("INSERT INTO mailbox_access (id, mailbox_id, user_id, permission, created_at) VALUES (?, ?, ?, ?, 0)").run(`${mailboxId}-${userId}`, mailboxId, userId, permission);
	addMailbox("mb1", "u1");
	addMailbox("mb1-old", "u1", "personal", true);
	addMailbox("team", "admin", "shared");
	addMailbox("u2-personal", "u2");
	grant("team", "u1");
	grant("team", "u2", "full_access");
	grant("u2-personal", "u1");
	return { database, sql, env: { DB: database }, grant };
}

test("a mailbox notifies its owner, the domain owner and, if shared, every member", async (t) => {
	const f = await mailFixture(t);
	assert.deepEqual(await lib.getMailboxNotificationUserIds(f.env, "mb1", "u1"), ["u1", "admin"]);
	assert.deepEqual(await lib.getMailboxNotificationUserIds(f.env, "team", "admin"), ["admin", "u1", "u2"]);
	// Access rows on a personal mailbox do not make it shared.
	assert.deepEqual(await lib.getMailboxNotificationUserIds(f.env, "u2-personal", "u2"), ["u2", "admin"]);
	assert.deepEqual(await lib.getMailboxNotificationUserIds(f.env, "missing", "u3"), ["u3"]);
});

test("a notification reaches every user's hub, and mail also goes to Web Push and native push", async (t) => {
	state.pushes = [];
	state.native = [];
	await lib.notifyUsersOfNewMessage({}, ["u1"], event);
	assert.deepEqual(state.pushes, [], "nothing without the REALTIME binding");

	const hubs = [];
	const env = { REALTIME: { getByName: (name) => ({ fetch: async (url, init) => {
		hubs.push({ name, url, method: init.method, body: JSON.parse(init.body) });
		if (name === "broken") throw new Error("hub unavailable");
		return new Response(null, { status: 204 });
	} }) } };
	await lib.notifyUsersOfNewMessage(env, ["u1", "u2"], event);
	assert.deepEqual(hubs.map((hub) => [hub.name, hub.url, hub.method]), [["u1", "https://mailclaw-realtime/notify", "POST"], ["u2", "https://mailclaw-realtime/notify", "POST"]]);
	assert.deepEqual(hubs[0].body, event);
	assert.deepEqual(state.pushes, [{ userIds: ["u1", "u2"], payload: event }]);
	assert.deepEqual(state.native, [{ userIds: ["u1", "u2"], payload: event }]);

	const draft = { type: "agent_draft", mailboxId: "mb-1", draftId: "draft-1" };
	await lib.notifyUsersOfNewMessage(env, ["u1"], draft);
	assert.equal(state.pushes.length, 1, "an agent draft is not pushed to devices");
	assert.deepEqual(hubs.at(-1).body, draft);

	const logged = t.mock.method(console, "error", () => {});
	await lib.notifyUsersOfNewMessage(env, ["broken", "u3"], event);
	assert.equal(logged.mock.callCount(), 1);
	assert.equal(hubs.at(-1).name, "u3", "one failing hub does not stop the others");
});

test("the mail revision covers owned and shared mailboxes and moves with their content and access", async (t) => {
	const f = await mailFixture(t);
	const revision = async (userId) => JSON.parse(await lib.getUserMailRevision(f.env, userId));
	assert.deepEqual(await revision("u1"), [["mb1", 0, "owner"], ["team", 0, "read_only"]]);
	assert.deepEqual(await revision("u3"), []);

	const before = await lib.getUserMailRevision(f.env, "u1");
	f.sql.prepare("INSERT INTO messages (id, mailbox_id, user_id, direction, from_addr, to_addr, subject, status, created_at) VALUES ('m1', 'team', 'admin', 'inbound', 'a@example.org', 'team@example.com', 's', 'received', 0)").run();
	const after = await revision("u1");
	assert.notEqual(JSON.stringify(after), before);
	assert.ok(after[1][1] > 0, "the shared mailbox's revision moved");

	f.sql.prepare("UPDATE mailbox_access SET permission = 'full_access' WHERE id = 'team-u1'").run();
	assert.equal((await revision("u1"))[1][2], "full_access");
	f.sql.prepare("UPDATE mailboxes SET disabled = 1 WHERE id = 'team'").run();
	assert.deepEqual((await revision("u1")).map((row) => row[0]), ["mb1"]);
});

function hubFixture(env) {
	const sockets = [];
	const ctx = {
		autoResponse: null,
		accepted: [],
		setWebSocketAutoResponse(pair) { ctx.autoResponse = pair; },
		getWebSockets: () => sockets,
		acceptWebSocket(socket) { ctx.accepted.push(socket); },
	};
	const hub = new lib.RealtimeHub(ctx, env);
	const socket = (userId, { failSend = false } = {}) => {
		let attachment = userId ? { userId } : null;
		const ws = {
			sent: [],
			closed: null,
			send(message) { if (failSend) throw new Error("closed"); ws.sent.push(message); },
			close(code, reason) { ws.closed = [code, reason]; },
			serializeAttachment(value) { attachment = value; },
			deserializeAttachment: () => attachment,
		};
		sockets.push(ws);
		return ws;
	};
	return { hub, ctx, socket };
}

test("the hub answers keep-alives without waking, broadcasts notifications and routes nothing else", async (t) => {
	const savedPair = globalThis.WebSocketRequestResponsePair;
	const savedSocketPair = globalThis.WebSocketPair;
	globalThis.WebSocketRequestResponsePair = class { constructor(request, response) { this.request = request; this.response = response; } };
	globalThis.WebSocketPair = class { constructor() { this[0] = { side: "client" }; this[1] = { side: "server" }; } };
	t.after(() => {
		globalThis.WebSocketRequestResponsePair = savedPair;
		globalThis.WebSocketPair = savedSocketPair;
	});
	const { hub, ctx, socket } = hubFixture({});
	assert.deepEqual({ ...ctx.autoResponse }, { request: "ping", response: "pong" });

	const healthy = socket("u1");
	const broken = socket("u1", { failSend: true });
	const response = await hub.fetch(new Request("https://mailclaw-realtime/notify", { method: "POST", body: JSON.stringify(event) }));
	assert.equal(response.status, 204);
	assert.deepEqual(healthy.sent.map((message) => JSON.parse(message)), [event]);
	assert.deepEqual(broken.closed, [1011, "Delivery failed"]);

	assert.equal((await hub.fetch(new Request("https://mailclaw-realtime/connect"))).status, 426);
	const anonymous = await hub.fetch(new Request("https://mailclaw-realtime/connect", { headers: { Upgrade: "websocket" } }));
	assert.equal(anonymous.status, 401);
	assert.equal(ctx.accepted.length, 0);
	assert.equal((await hub.fetch(new Request("https://mailclaw-realtime/notify"))).status, 404);
	assert.equal((await hub.fetch(new Request("https://mailclaw-realtime/other", { method: "POST" }))).status, 404);
});

test("a revision check answers whether the user's mail changed since the client's revision", async (t) => {
	const savedPair = globalThis.WebSocketRequestResponsePair;
	globalThis.WebSocketRequestResponsePair = class {};
	t.after(() => { globalThis.WebSocketRequestResponsePair = savedPair; });
	const f = await mailFixture(t);
	const { hub, socket } = hubFixture(f.env);
	const ws = socket("u1");
	const replies = () => ws.sent.map((message) => (message === "pong" ? message : JSON.parse(message)));
	const current = await lib.getUserMailRevision(f.env, "u1");

	await hub.webSocketMessage(ws, "ping");
	await hub.webSocketMessage(ws, JSON.stringify({ type: "ping", revision: null }));
	await hub.webSocketMessage(ws, JSON.stringify({ type: "ping", revision: current }));
	await hub.webSocketMessage(ws, JSON.stringify({ type: "ping", revision: "[]" }));
	assert.deepEqual(replies(), [
		"pong",
		{ type: "revision", revision: current, changed: false },
		{ type: "revision", revision: current, changed: false },
		{ type: "revision", revision: current, changed: true },
	]);

	ws.sent.length = 0;
	await hub.webSocketMessage(ws, new ArrayBuffer(4));
	await hub.webSocketMessage(ws, "{not json");
	await hub.webSocketMessage(ws, JSON.stringify({ type: "hello" }));
	await hub.webSocketMessage(socket(null), JSON.stringify({ type: "ping", revision: null }));
	assert.deepEqual(ws.sent, []);

	const failing = hubFixture({ DB: { prepare() { throw new Error("D1 unavailable"); } } });
	const lost = failing.socket("u1");
	await failing.hub.webSocketMessage(lost, JSON.stringify({ type: "ping", revision: null }));
	assert.deepEqual(lost.closed, [1011, "Revision lookup failed"]);
});
