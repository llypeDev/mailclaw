import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

// Session routes used to call `requireUser`, which throws and surfaces as a 500 (or, inside a
// try/catch, a 403/400). They now go through the real `requireSessionUser`, so a request with
// no session must get a 401 JSON body before any database or binding is touched.
const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(project, "node_modules", "session-auth-routes-test-"));
after(() => {
	rmSync(temporary, { recursive: true, force: true });
	delete globalThis.sessionAuthUser;
});
const mocks = {
	"next/server": "export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } } export const NextResponse={json:(data,init)=>Response.json(data,init)};",
	"@/lib/auth/cookies": "export async function getCurrentUser(){return globalThis.sessionAuthUser ?? null}",
	"@/lib/cloudflare": "export function getEnv(){return new Proxy({}, { get(_, key){ if (key === 'then') return undefined; throw new Error('Binding read before auth: '+String(key)); } })}",
	"@/db": "export function getDb(){throw new Error('Database opened before auth')}",
};
const routes = {
	accounts: "accounts/route",
	adminUpdate: "admin/update/route",
	backups: "backups/route",
	backupRestore: "backups/restore/route",
	branding: "branding/route",
	contacts: "contacts/route",
	domains: "domains/route",
	domainCheck: "domains/check/route",
	drafts: "drafts/route",
	folders: "folders/route",
	mailboxes: "mailboxes/route",
	imapFolders: "import/imap/folders/route",
	send: "send/route",
	password: "settings/password/route",
};
await build({
	stdin: {
		contents: Object.entries(routes).map(([name, path]) => `export * as ${name} from './src/app/api/${path}';`).join("\n"),
		resolveDir: project,
		loader: "ts",
	},
	outfile: join(temporary, "routes.mjs"),
	bundle: true,
	platform: "node",
	format: "esm",
	packages: "external",
	alias: { "@": join(project, "src") },
	logLevel: "silent",
	plugins: [{ name: "session-auth-mocks", setup(builder) {
		builder.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: "mock" } : undefined);
		builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
	} }],
});
const loaded = await import(pathToFileURL(join(temporary, "routes.mjs")).href);
const request = (path, method) => new Request(`https://mail.test/api/${path}`, {
	method,
	headers: { Origin: "https://mail.test", "Content-Type": "application/json" },
	...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
});

const cases = [
	["accounts", "GET"], ["accounts", "POST"],
	["adminUpdate", "GET"], ["adminUpdate", "POST"],
	["backups", "GET"], ["backups", "PUT"], ["backups", "POST"],
	["backupRestore", "POST"],
	["branding", "PUT"],
	["contacts", "GET"], ["contacts", "POST"], ["contacts", "PATCH"], ["contacts", "DELETE"],
	["domains", "GET"], ["domains", "POST"],
	["domainCheck", "POST"],
	["drafts", "GET"], ["drafts", "POST"],
	["folders", "GET"], ["folders", "POST"],
	["imapFolders", "POST"],
	["mailboxes", "GET"], ["mailboxes", "POST"],
	["send", "POST"],
	["password", "PATCH"], ["password", "POST"], ["password", "DELETE"],
];

test("session routes answer 401 JSON without a session instead of throwing", async () => {
	globalThis.sessionAuthUser = null;
	for (const [name, method] of cases) {
		const handler = loaded[name][method];
		assert.equal(typeof handler, "function", `${name} ${method} is exported`);
		const response = await handler(request(routes[name], method));
		assert.equal(response.status, 401, `${name} ${method}`);
		assert.deepEqual(await response.json(), { error: "Unauthorized" }, `${name} ${method}`);
	}
});

test("a signed-in non-admin still gets the routes' own 403", async () => {
	globalThis.sessionAuthUser = { id: "user", role: "user", isPrimaryAdmin: false, canManageDomains: false, canManageUsers: false };
	for (const [name, method] of [["accounts", "GET"], ["adminUpdate", "GET"], ["backups", "GET"], ["branding", "PUT"], ["domains", "POST"]]) {
		const response = await loaded[name][method](request(routes[name], method));
		assert.equal(response.status, 403, `${name} ${method}`);
	}
});
