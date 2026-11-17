import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The R2 bucket API over a directory. Objects are files under `root`; the
 * HTTP and custom metadata R2 would keep ride in a `.meta.json` sidecar.
 * Covers what the app uses: get (with a byte range), put, delete, head, and multipart uploads.
 */
type StoredMeta = {
	httpMetadata?: { contentType?: string; contentDisposition?: string; cacheControl?: string };
	customMetadata?: Record<string, string>;
	size: number;
	uploaded: string;
	etag: string;
};

const PARTIAL_SUFFIX = /\.[0-9a-f-]{36}\.partial$/;

/** Sidecars and in-progress writes live next to objects but are not objects. */
function isObjectFile(name: string) {
	return !name.endsWith(".meta.json") && !PARTIAL_SUFFIX.test(name);
}

function assertInside(root: string, path: string) {
	const full = resolve(path);
	if (full !== root && !full.startsWith(root + sep)) throw new Error("Object key escapes the bucket root");
	return full;
}

class FileObject {
	constructor(
		readonly key: string,
		private readonly path: string,
		private readonly meta: StoredMeta,
		private readonly range?: { offset: number; length: number },
	) {}

	get size() {
		return this.meta.size;
	}
	get etag() {
		return this.meta.etag;
	}
	get httpEtag() {
		return `"${this.meta.etag}"`;
	}
	get uploaded() {
		return new Date(this.meta.uploaded);
	}
	get httpMetadata() {
		return this.meta.httpMetadata ?? {};
	}
	get customMetadata() {
		return this.meta.customMetadata ?? {};
	}
	get version() {
		return this.meta.etag;
	}
	get body(): ReadableStream<Uint8Array> {
		const options = this.range ? { start: this.range.offset, end: this.range.offset + this.range.length - 1 } : undefined;
		return Readable.toWeb(createReadStream(this.path, options)) as ReadableStream<Uint8Array>;
	}
	get bodyUsed() {
		return false;
	}
	async arrayBuffer(): Promise<ArrayBuffer> {
		if (!this.range) {
			const buffer = await readFile(this.path);
			return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
		}
		// Read only the requested bytes; a header sniff must not load a 36 MB message.
		const handle = await open(this.path, "r");
		try {
			const buffer = new Uint8Array(Math.max(this.range.length, 0));
			let filled = 0;
			while (filled < buffer.byteLength) {
				const { bytesRead } = await handle.read(buffer, filled, buffer.byteLength - filled, this.range.offset + filled);
				if (bytesRead === 0) break;
				filled += bytesRead;
			}
			return buffer.buffer.slice(0, filled) as ArrayBuffer;
		} finally {
			await handle.close();
		}
	}
	async text(): Promise<string> {
		return Buffer.from(await this.arrayBuffer()).toString("utf8");
	}
	async json<T>(): Promise<T> {
		return JSON.parse(await this.text()) as T;
	}
	async blob(): Promise<Blob> {
		return new Blob([await this.arrayBuffer()], { type: this.meta.httpMetadata?.contentType });
	}
	writeHttpMetadata(headers: Headers) {
		if (this.meta.httpMetadata?.contentType) headers.set("Content-Type", this.meta.httpMetadata.contentType);
		if (this.meta.httpMetadata?.contentDisposition) headers.set("Content-Disposition", this.meta.httpMetadata.contentDisposition);
		if (this.meta.httpMetadata?.cacheControl) headers.set("Cache-Control", this.meta.httpMetadata.cacheControl);
	}
}

export class FileBucket {
	private readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	private pathFor(key: string) {
		return assertInside(this.root, join(this.root, key));
	}

	private async readMeta(key: string): Promise<StoredMeta | null> {
		try {
			return JSON.parse(await readFile(`${this.pathFor(key)}.meta.json`, "utf8")) as StoredMeta;
		} catch {
			try {
				const info = await stat(this.pathFor(key));
				return { size: info.size, uploaded: info.mtime.toISOString(), etag: String(info.mtimeMs) };
			} catch {
				return null;
			}
		}
	}

	async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
		const meta = await this.readMeta(key);
		if (!meta) return null;
		let range: { offset: number; length: number } | undefined;
		if (options?.range) {
			const offset = options.range.suffix != null ? Math.max(meta.size - options.range.suffix, 0) : options.range.offset ?? 0;
			const length = Math.min(options.range.length ?? meta.size - offset, meta.size - offset);
			range = { offset, length };
		}
		return new FileObject(key, this.pathFor(key), meta, range);
	}

	async head(key: string) {
		const meta = await this.readMeta(key);
		return meta ? new FileObject(key, this.pathFor(key), meta) : null;
	}

	async put(
		key: string,
		value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null,
		options?: { httpMetadata?: StoredMeta["httpMetadata"] | Headers; customMetadata?: Record<string, string> },
	) {
		const path = this.pathFor(key);
		await mkdir(dirname(path), { recursive: true });
		let size: number;
		if (value instanceof ReadableStream || value instanceof Blob) {
			// Streams and blobs go to disk as they arrive instead of being buffered whole;
			// the temporary name keeps a half-written object from ever being readable.
			const temporary = `${path}.${randomUUID()}.partial`;
			try {
				const source = Readable.fromWeb((value instanceof Blob ? value.stream() : value) as never);
				await pipeline(source, createWriteStream(temporary));
				({ size } = await stat(temporary));
				await rename(temporary, path);
			} catch (error) {
				await rm(temporary, { force: true });
				throw error;
			}
		} else {
			let buffer: Buffer;
			if (value === null) buffer = Buffer.alloc(0);
			else if (typeof value === "string") buffer = Buffer.from(value);
			else if (value instanceof ArrayBuffer) buffer = Buffer.from(value);
			else buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
			await writeFile(path, buffer);
			size = buffer.byteLength;
		}
		const httpMetadata =
			options?.httpMetadata instanceof Headers
				? { contentType: options.httpMetadata.get("content-type") ?? undefined }
				: options?.httpMetadata;
		const meta: StoredMeta = {
			httpMetadata,
			customMetadata: options?.customMetadata,
			size,
			uploaded: new Date().toISOString(),
			etag: `${Date.now().toString(16)}-${size.toString(16)}`,
		};
		await writeFile(`${path}.meta.json`, JSON.stringify(meta));
		return new FileObject(key, path, meta);
	}

	private multipartDirectory(uploadId: string) {
		if (!/^[\w-]+$/.test(uploadId)) throw new Error("Invalid multipart upload id");
		return join(this.root, ".multipart", uploadId);
	}

	async createMultipartUpload(key: string, options?: { httpMetadata?: StoredMeta["httpMetadata"] }) {
		const uploadId = randomUUID();
		await mkdir(this.multipartDirectory(uploadId), { recursive: true });
		await writeFile(join(this.multipartDirectory(uploadId), "meta.json"), JSON.stringify(options?.httpMetadata ?? {}));
		return this.resumeMultipartUpload(key, uploadId);
	}

	resumeMultipartUpload(key: string, uploadId: string) {
		const directory = this.multipartDirectory(uploadId);
		const partPath = (partNumber: number) => join(directory, `part-${partNumber}`);
		return {
			key,
			uploadId,
			uploadPart: async (partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob) => {
				if (!Number.isInteger(partNumber) || partNumber < 1) throw new Error("Invalid part number");
				const source = value instanceof ReadableStream ? Readable.fromWeb(value as never) : Readable.from(Buffer.from(value instanceof Blob ? await value.arrayBuffer() : typeof value === "string" ? value : value instanceof ArrayBuffer ? value : (value as ArrayBufferView).buffer));
				await pipeline(source, createWriteStream(partPath(partNumber)));
				const { size } = await stat(partPath(partNumber));
				return { partNumber, etag: `${partNumber}-${size.toString(16)}` };
			},
			abort: async () => { await rm(directory, { recursive: true, force: true }); },
			complete: async (parts: { partNumber: number; etag: string }[]) => {
				const path = this.pathFor(key);
				await mkdir(dirname(path), { recursive: true });
				const out = createWriteStream(path);
				try {
					for (const part of [...parts].sort((a, b) => a.partNumber - b.partNumber)) await pipeline(createReadStream(partPath(part.partNumber)), out, { end: false });
				} finally { out.end(); }
				await new Promise<void>((done) => out.once("close", () => done()));
				const httpMetadata = JSON.parse(await readFile(join(directory, "meta.json"), "utf8")) as StoredMeta["httpMetadata"];
				const { size } = await stat(path);
				const meta: StoredMeta = { httpMetadata, size, uploaded: new Date().toISOString(), etag: `${Date.now().toString(16)}-${size.toString(16)}` };
				await writeFile(`${path}.meta.json`, JSON.stringify(meta));
				await rm(directory, { recursive: true, force: true });
				return new FileObject(key, path, meta);
			},
		};
	}

	async delete(keys: string | string[]) {
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			const path = this.pathFor(key);
			await rm(path, { force: true });
			await rm(`${path}.meta.json`, { force: true });
		}
	}

	/**
	 * Lists objects under a prefix in key order; the cursor is the last key returned.
	 * The walk starts at the prefix's directory, visits entries in key order, skips
	 * whole directories that sort before the cursor and stops one key past the page,
	 * so a page costs about what it returns rather than the whole tree.
	 */
	async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
		const prefix = options.prefix ?? "";
		const cursor = options.cursor ?? "";
		const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000));
		const keys: string[] = [];
		const slash = prefix.lastIndexOf("/");
		const base = slash >= 0 ? prefix.slice(0, slash) : "";
		const walk = async (directory: string, relative: string): Promise<void> => {
			let entries;
			try {
				entries = await readdir(directory, { withFileTypes: true });
			} catch {
				return;
			}
			// A directory's keys all start with `name/`, so that is what it sorts by among its siblings.
			const ordered = entries
				.filter((entry) => !(relative === "" && entry.name === ".multipart"))
				.map((entry) => ({ entry, sortKey: `${relative ? `${relative}/` : ""}${entry.name}${entry.isDirectory() ? "/" : ""}` }))
				.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
			for (const { entry, sortKey } of ordered) {
				if (keys.length > limit) return;
				if (entry.isDirectory()) {
					// Skip directories outside the prefix, and ones whose every key sorts at or before the cursor.
					if (!sortKey.startsWith(prefix) && !prefix.startsWith(sortKey)) continue;
					if (cursor && sortKey < cursor && !cursor.startsWith(sortKey)) continue;
					await walk(join(directory, entry.name), sortKey.slice(0, -1));
				} else if (isObjectFile(entry.name) && sortKey.startsWith(prefix) && sortKey > cursor) {
					keys.push(sortKey);
				}
			}
		};
		await walk(base ? this.pathFor(base) : this.root, base);
		const truncated = keys.length > limit;
		const page = keys.slice(0, limit);
		const objects: { key: string; size: number; uploaded: Date }[] = [];
		for (const key of page) {
			const meta = await this.readMeta(key);
			if (meta) objects.push({ key, size: meta.size, uploaded: new Date(meta.uploaded) });
		}
		return { objects, truncated, cursor: truncated ? page[page.length - 1] : undefined };
	}
}

export function openFileBucket(root: string): R2Bucket {
	return new FileBucket(root) as unknown as R2Bucket;
}
