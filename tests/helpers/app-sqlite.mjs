import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundles app modules (with literal module mocks) together with the self-hosted SQLite
// wrapper and migration runner, so a test can run real queries against a fully migrated
// database. Migrations run once into a template file; every fixture opens its own copy.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `exports` are lines of the bundle entry, e.g. `export * from "./src/lib/drive/utils.ts";`.
 * `mocks` maps an import specifier (as written in the source) to the module text replacing it.
 */
export async function loadAppWithSqlite({ name, exports, mocks = {} }) {
	const directory = mkdtempSync(join(root, "tests", `.tmp-${name}-`));
	try {
		return await load(directory, { name, exports, mocks });
	} catch (error) {
		rmSync(directory, { recursive: true, force: true });
		throw error;
	}
}

async function load(directory, { name, exports, mocks }) {
	await build({
		stdin: {
			contents: [
				`export { SqliteDatabase } from "./server/runtime/sqlite-database.ts";`,
				`export { applyMigrations } from "./server/runtime/migrate.ts";`,
				...exports,
			].join("\n"),
			resolveDir: root,
			sourcefile: `${name}-entry.ts`,
			loader: "ts",
		},
		outfile: join(directory, "entry.mjs"),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		tsconfig: join(root, "tsconfig.json"),
		packages: "external",
		// Next's package has no exports map, so Node needs the file names; Workers modules use the Node runtime's stand-in.
		// A mocked specifier is not aliased, so the mock wins.
		alias: Object.fromEntries(Object.entries({
			"next/headers": "next/headers.js",
			"next/server": "next/server.js",
			"cloudflare:workers": "./server/runtime/cloudflare-workers.ts",
		}).filter(([specifier]) => !(specifier in mocks))),
		logLevel: "silent",
		plugins: [{
			name: `${name}-mocks`,
			setup(builder) {
				builder.onResolve({ filter: /.*/ }, ({ path }) => (path in mocks ? { path, namespace: "mock" } : undefined));
				builder.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
			},
		}],
	});
	const lib = await import(pathToFileURL(join(directory, "entry.mjs")).href);

	let template = null;
	/** A fresh, migrated database for one test; closed when the test ends. */
	async function openDatabase(t) {
		if (!template) {
			template = join(directory, "template.sqlite");
			const seed = new lib.SqliteDatabase(template);
			await lib.applyMigrations(seed, join(root, "drizzle/migrations"));
			// Closing checkpoints the WAL, so the single file holds the whole schema.
			seed.db.close();
		}
		const file = join(directory, `${crypto.randomUUID()}.sqlite`);
		copyFileSync(template, file);
		const database = new lib.SqliteDatabase(file);
		t?.after(() => database.db.close());
		return database;
	}

	/** An empty database (no schema at all). */
	function openEmptyDatabase(t) {
		const database = new lib.SqliteDatabase(join(directory, `${crypto.randomUUID()}.sqlite`));
		t?.after(() => database.db.close());
		return database;
	}

	return {
		lib,
		openDatabase,
		openEmptyDatabase,
		dispose: () => rmSync(directory, { recursive: true, force: true }),
	};
}

/** An R2-shaped bucket that records writes and deletions. */
export function recordingBucket() {
	const objects = new Map();
	const bucket = {
		objects,
		deleted: [],
		puts: [],
		multipart: [],
		async put(key, value, options) {
			bucket.puts.push({ key, options });
			objects.set(key, value);
			return { key };
		},
		async delete(keys) {
			for (const key of [keys].flat()) {
				bucket.deleted.push(key);
				objects.delete(key);
			}
		},
		async createMultipartUpload(key, options) {
			const uploadId = `upload-${bucket.multipart.length + 1}`;
			const upload = { key, options, uploadId, aborted: false, async abort() { upload.aborted = true; } };
			bucket.multipart.push(upload);
			return upload;
		},
		resumeMultipartUpload(key, uploadId) {
			return { key, uploadId, async abort() { bucket.multipart.push({ key, uploadId, aborted: true }); } };
		},
	};
	return bucket;
}

/** Seconds since the epoch, the representation every timestamp column stores. */
export const seconds = (date) => Math.floor(date.getTime() / 1000);
export const DAY_MS = 24 * 60 * 60 * 1000;
