/** Workers allow six simultaneous open connections per invocation; R2 calls stay within that. */
export const ATTACHMENT_STORAGE_CONCURRENCY = 6;

/** D1 binds at most 100 parameters per statement; an attachment row binds 9. */
export const ATTACHMENT_ROWS_PER_INSERT = 10;

/**
 * Runs `task` over `items` with at most `limit` in flight and returns the results in input
 * order. After the first failure no new task starts, but the ones already running are awaited
 * before the error is rethrown, so a caller cleaning up afterwards sees every write that landed.
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	let failure: { error: unknown } | null = null;
	const worker = async () => {
		while (!failure && next < items.length) {
			const index = next++;
			try {
				results[index] = await task(items[index], index);
			} catch (error) {
				failure ??= { error };
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
	if (failure) throw (failure as { error: unknown }).error;
	return results;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
	return chunks;
}
