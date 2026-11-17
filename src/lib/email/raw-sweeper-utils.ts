export const RAW_SWEEP_PREFIX = "inbound/";

/**
 * Raw MIME must outlive every copy of its queue message. A message can wait in the inbound queue for
 * its retention (24 hours on Workers Free, configurable up to 14 days on Paid) and then sit in the
 * dead-letter queue for as long again (4 days by default), from where an operator may still replay
 * it. 30 days covers the longest combination (14 + 14) with room to spare.
 */
export const RAW_SWEEP_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RAW_SWEEP_PAGE = 100;
/** Pages listed per run; the cursor carries the rest of the prefix over to the next run. */
export const RAW_SWEEP_MAX_PAGES = 20;
/** D1 allows 100 bound parameters per statement. */
export const RAW_SWEEP_LOOKUP_BATCH = 50;
/**
 * Where the listing cursor is kept between runs. It lives in the bucket rather than the database,
 * next to the objects it walks, so the sweeper needs no table of its own.
 */
export const RAW_SWEEP_STATE_KEY = "system/raw-sweeper.json";

export type RawSweepState = {
	/** Listing cursor to resume from; null starts again at the beginning of the prefix. */
	cursor: string | null;
	updatedAt?: string;
};

export type RawSweepBucket = Pick<R2Bucket, "list" | "delete" | "get" | "put">;

/** Returns the subset of `keys` that a stored message still refers to. */
export type FindReferencedRawKeys = (keys: string[]) => Promise<Iterable<string>>;

export function parseRawSweepState(text: string | null | undefined): RawSweepState {
	if (!text) return { cursor: null };
	try {
		const parsed = JSON.parse(text) as { cursor?: unknown };
		return { cursor: typeof parsed?.cursor === "string" && parsed.cursor ? parsed.cursor : null };
	} catch {
		return { cursor: null };
	}
}

export async function readRawSweepState(bucket: RawSweepBucket): Promise<RawSweepState> {
	try {
		const object = await bucket.get(RAW_SWEEP_STATE_KEY);
		return parseRawSweepState(object ? await object.text() : null);
	} catch (error) {
		console.error("Raw mail sweep: could not read the saved cursor, starting from the beginning", error);
		return { cursor: null };
	}
}

async function saveRawSweepState(bucket: RawSweepBucket, state: RawSweepState): Promise<void> {
	try {
		await bucket.put(RAW_SWEEP_STATE_KEY, JSON.stringify(state), { httpMetadata: { contentType: "application/json" } });
	} catch (error) {
		console.error("Raw mail sweep: could not save the cursor", error);
	}
}

export type RawSweepResult = { removed: number; listed: number; cursor: string | null };

/**
 * One sweep run over at most RAW_SWEEP_MAX_PAGES listing pages, resuming where the previous run
 * stopped. When the listing reaches the end of the prefix the cursor is cleared, so the next run
 * wraps around to the beginning; every object is therefore visited once per full cycle however
 * many objects the bucket holds.
 */
export async function sweepRawObjects(
	bucket: RawSweepBucket,
	now: Date,
	findReferenced: FindReferencedRawKeys,
): Promise<RawSweepResult> {
	const saved = await readRawSweepState(bucket);
	let cursor: string | undefined = saved.cursor ?? undefined;
	let removed = 0;
	let listed = 0;
	for (let page = 0; page < RAW_SWEEP_MAX_PAGES; page += 1) {
		let listing: Awaited<ReturnType<RawSweepBucket["list"]>>;
		try {
			listing = await bucket.list({ prefix: RAW_SWEEP_PREFIX, cursor, limit: RAW_SWEEP_PAGE });
		} catch (error) {
			// A cursor the store no longer accepts (expired, or the store was swapped) must not wedge
			// the sweeper forever: start over from the beginning on the next run.
			if (page === 0 && cursor) {
				console.error("Raw mail sweep: the saved cursor was refused, restarting from the beginning", error);
				await saveRawSweepState(bucket, { cursor: null, updatedAt: now.toISOString() });
			}
			throw error;
		}
		listed += listing.objects.length;
		const old = listing.objects
			.filter((object) => now.getTime() - object.uploaded.getTime() > RAW_SWEEP_MIN_AGE_MS)
			.map((object) => object.key);
		const orphans: string[] = [];
		for (let index = 0; index < old.length; index += RAW_SWEEP_LOOKUP_BATCH) {
			const batch = old.slice(index, index + RAW_SWEEP_LOOKUP_BATCH);
			const kept = new Set(await findReferenced(batch));
			orphans.push(...batch.filter((key) => !kept.has(key)));
		}
		if (orphans.length) {
			await bucket.delete(orphans);
			removed += orphans.length;
		}
		cursor = listing.truncated && listing.cursor ? listing.cursor : undefined;
		// Saved after every page, so a run cut short by a limit still keeps what it walked.
		await saveRawSweepState(bucket, { cursor: cursor ?? null, updatedAt: now.toISOString() });
		if (!cursor) break;
	}
	return { removed, listed, cursor: cursor ?? null };
}
