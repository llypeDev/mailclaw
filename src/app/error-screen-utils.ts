/** Errors from Server Components carry a digest that matches the server log line. */
export function readErrorDigest(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("digest" in error)) return null;
	const digest = (error as { digest?: unknown }).digest;
	return typeof digest === "string" && digest ? digest : null;
}
