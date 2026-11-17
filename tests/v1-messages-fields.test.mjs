import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(root, "tests", ".tmp-v1-messages-"));
after(() => {
	rmSync(outDir, { recursive: true, force: true });
	delete globalThis.v1MessagesFixture;
});
const mocks = {
	"@/lib/cloudflare": "export function getEnv() { return globalThis.v1MessagesFixture.env; }",
	"@/lib/api/auth": `
		export async function authenticateApiKey() { return globalThis.v1MessagesFixture.auth; }
		export function requireScope(scopes, scope) { return scopes.includes(scope); }
	`,
};
await build({
	entryPoints: {
		route: join(root, "src/app/api/v1/messages/route.ts"),
		database: join(root, "server/runtime/sqlite-database.ts"),
		migrate: join(root, "server/runtime/migrate.ts"),
	},
	outdir: outDir,
	outExtension: { ".js": ".mjs" },
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	tsconfig: join(root, "tsconfig.json"),
	logLevel: "silent",
	plugins: [{
		name: "v1-messages-fixtures",
		setup(builder) {
			builder.onResolve({ filter: /^next\/server$/ }, () => ({ path: "next/server.js", external: true }));
			builder.onResolve({ filter: /^@\/lib\// }, (args) => args.path in mocks ? { path: args.path, namespace: "mock" } : undefined);
			builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
		},
	}],
});
const { GET } = await import(pathToFileURL(join(outDir, "route.mjs")).href);
const { SqliteDatabase } = await import(pathToFileURL(join(outDir, "database.mjs")).href);
const { applyMigrations } = await import(pathToFileURL(join(outDir, "migrate.mjs")).href);
const request = (query = "") => new Request(`https://mail.example/api/v1/messages?${query}`, { headers: { authorization: "Bearer key" } });

async function fixture(t) {
	const database = new SqliteDatabase(":memory:");
	t.after(() => database.db.close());
	await applyMigrations(database, join(root, "drizzle/migrations"));
	database.db.exec(`
		INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('owner', 'owner@example.com', 'Owner', 'x', 'admin', 0);
		INSERT INTO domains (id, user_id, hostname, zone_id, created_at) VALUES ('domain', 'owner', 'example.com', 'zone', 0);
		INSERT INTO mailboxes (id, user_id, domain_id, local_part, type, disabled, created_at) VALUES ('mine', 'owner', 'domain', 'owner', 'personal', 0, 0);
		INSERT INTO messages (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, snippet, text_body, html_body, status, created_at)
			VALUES ('m1', 'owner', 'mine', 'inbound', 'a@example.net', 'owner@example.com', 'Hello', 'preview', 'full body', '<p>full body</p>', 'received', 1);
	`);
	const queries = [];
	const prepare = database.prepare.bind(database);
	database.prepare = (sql) => {
		queries.push(sql);
		return prepare(sql);
	};
	globalThis.v1MessagesFixture = {
		env: { DB: database },
		auth: { userId: "owner", user: { id: "owner", email: "owner@example.com", role: "admin", timeZone: null }, scopes: ["read"], mailboxIds: null },
	};
	return { queries };
}

test("v1 messages keep the bodies by default", async (t) => {
	await fixture(t);
	const body = await (await GET(request("mailboxId=mine"))).json();
	assert.equal(body.messages.length, 1);
	assert.equal(body.messages[0].textBody, "full body");
	assert.equal(body.messages[0].htmlBody, "<p>full body</p>");
});

test("fields=summary lists the same messages without reading the bodies", async (t) => {
	const { queries } = await fixture(t);
	const full = (await (await GET(request("mailboxId=mine"))).json()).messages[0];
	queries.length = 0;
	const response = await GET(request("mailboxId=mine&fields=summary"));
	assert.equal(response.status, 200);
	const [summary] = (await response.json()).messages;
	assert.equal("textBody" in summary, false);
	assert.equal("htmlBody" in summary, false);
	const rest = { ...full };
	delete rest.textBody;
	delete rest.htmlBody;
	assert.deepEqual(summary, rest);
	const select = queries.find((sql) => sql.includes('from "messages"'));
	assert.doesNotMatch(select, /text_body|html_body/);
});

test("an unknown fields value is refused rather than ignored", async (t) => {
	await fixture(t);
	const response = await GET(request("fields=bodies"));
	assert.equal(response.status, 400);
	assert.match((await response.json()).error, /fields=summary/);
});
