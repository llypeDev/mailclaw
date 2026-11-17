/** Whether a key's `lastUsedAt` is old enough (or unset) to be written again. */
export function isLastUsedStale(lastUsedAt: Date | null | undefined, staleBefore: Date): boolean {
	return !lastUsedAt || lastUsedAt.getTime() < staleBefore.getTime();
}
