/**
 * "Already processed" markers for signed inbound requests (the relay webhook,
 * SNS notifications). A marker only has to outlive the window in which a
 * captured request still verifies, so markers live under a time bucket:
 * `<prefix>/t/<bucket>/<id>`, with buckets `windowSeconds` wide. A marker
 * written at time t is found until the bucket after t's ends, which is at least
 * one window later, by checking the current and the previous bucket.
 *
 * Old buckets are deleted opportunistically, at most once per bucket per
 * isolate, from the request that writes a marker. Keys sort by bucket, so the
 * sweep reads from the oldest and stops at the first live marker. Markers from
 * before buckets existed (`<prefix>/<id>`, which sort before `t/` because ids
 * are hex or UUIDs) are deleted by age as the sweep passes them.
 */
export type ReplayMarkerBucket = Pick<R2Bucket, "head" | "put" | "delete" | "list">;

export type ReplayWindow = { prefix: string; windowSeconds: number };

/** The relay signs a timestamp it allows 300 s either way, so a request verifies for up to 600 s. */
export const RELAY_REPLAY_WINDOW: ReplayWindow = { prefix: "relay-seen", windowSeconds: 600 };
/** SNS signatures are accepted for 24 hours either side of their timestamp. */
export const SNS_REPLAY_WINDOW: ReplayWindow = { prefix: "sns-seen", windowSeconds: 2 * 24 * 60 * 60 };

const SWEEP_PAGE = 500;
const SWEEP_MAX_PAGES = 4;
const lastSwept = new Map<string, number>();

function bucketOf(window: ReplayWindow, nowMs: number): number {
	return Math.floor(nowMs / 1000 / window.windowSeconds);
}

function bucketPrefix(window: ReplayWindow, bucket: number): string {
	return `${window.prefix}/t/${String(bucket).padStart(12, "0")}/`;
}

export function replayMarkerKey(window: ReplayWindow, id: string, nowMs = Date.now()): string {
	return `${bucketPrefix(window, bucketOf(window, nowMs))}${id}`;
}

export async function hasReplayMarker(bucket: ReplayMarkerBucket, window: ReplayWindow, id: string, nowMs = Date.now()): Promise<boolean> {
	const current = bucketOf(window, nowMs);
	const [inCurrent, inPrevious] = await Promise.all([
		bucket.head(`${bucketPrefix(window, current)}${id}`),
		bucket.head(`${bucketPrefix(window, current - 1)}${id}`),
	]);
	return !!(inCurrent || inPrevious);
}

/** Writes the marker, then sweeps expired buckets if this isolate has not yet this bucket. */
export async function rememberReplayMarker(bucket: ReplayMarkerBucket, window: ReplayWindow, id: string, nowMs = Date.now()): Promise<void> {
	await bucket.put(replayMarkerKey(window, id, nowMs), new Uint8Array(0));
	const current = bucketOf(window, nowMs);
	if (lastSwept.get(window.prefix) === current) return;
	lastSwept.set(window.prefix, current);
	await sweepReplayMarkers(bucket, window, nowMs).catch((error) => console.warn(`Replay marker sweep failed for ${window.prefix}`, error));
}

/**
 * Deletes markers older than the previous bucket (and legacy markers older than
 * two windows). Bounded to a few listing pages; whatever is left goes next time.
 */
export async function sweepReplayMarkers(bucket: ReplayMarkerBucket, window: ReplayWindow, nowMs = Date.now()): Promise<number> {
	const keepFrom = bucketPrefix(window, bucketOf(window, nowMs) - 1);
	const legacyCutoff = nowMs - 2 * window.windowSeconds * 1000;
	const bucketed = `${window.prefix}/t/`;
	let removed = 0;
	let cursor: string | undefined;
	for (let page = 0; page < SWEEP_MAX_PAGES; page += 1) {
		const listing = await bucket.list({ prefix: `${window.prefix}/`, cursor, limit: SWEEP_PAGE });
		const expired: string[] = [];
		let reachedLive = false;
		for (const object of listing.objects) {
			if (object.key.startsWith(bucketed)) {
				if (object.key >= keepFrom) {
					reachedLive = true;
					break;
				}
				expired.push(object.key);
			} else if (object.uploaded.getTime() < legacyCutoff) {
				expired.push(object.key);
			}
		}
		if (expired.length) {
			await bucket.delete(expired);
			removed += expired.length;
		}
		if (reachedLive || !listing.truncated) break;
		cursor = (listing as { cursor?: string }).cursor;
		if (!cursor) break;
	}
	return removed;
}
