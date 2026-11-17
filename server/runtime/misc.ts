import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

/**
 * A fixed-window limiter with the `RateLimit` binding's shape. Expired windows
 * are dropped once per period, so the map only holds keys seen in the last two.
 */
export function openRateLimiter(limit: number, periodSeconds: number, clock: () => number = Date.now): RateLimit & { size(): number } {
	const windows = new Map<string, { count: number; resetAt: number }>();
	const periodMs = periodSeconds * 1000;
	let nextSweep = clock() + periodMs;
	return {
		size: () => windows.size,
		async limit({ key }: { key: string }) {
			const now = clock();
			if (now >= nextSweep) {
				for (const [windowKey, window] of windows) if (window.resetAt <= now) windows.delete(windowKey);
				nextSweep = now + periodMs;
			}
			const current = windows.get(key);
			if (!current || current.resetAt <= now) {
				windows.set(key, { count: 1, resetAt: now + periodSeconds * 1000 });
				return { success: true };
			}
			current.count += 1;
			return { success: current.count <= limit };
		},
	} as unknown as RateLimit & { size(): number };
}

const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".ico": "image/x-icon",
	".svg": "image/svg+xml",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".json": "application/json",
	".txt": "text/plain",
};

/** The `ASSETS` fetcher over the public directory. */
export function openAssets(publicDir: string): Fetcher {
	const root = resolve(publicDir);
	return {
		async fetch(input: RequestInfo | URL) {
			const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
			const path = resolve(join(root, url.pathname));
			if (path !== root && !path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
			try {
				const body = await readFile(path);
				return new Response(body, { headers: { "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream" } });
			} catch {
				return new Response("Not found", { status: 404 });
			}
		},
	} as unknown as Fetcher;
}
