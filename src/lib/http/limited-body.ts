/**
 * Reads a request body into memory, refusing it as soon as it is known to be
 * larger than `limit`: from Content-Length before reading anything, and while
 * reading for bodies that send none (chunked) or understate it. Returns null
 * when the body is too large; nothing past the limit is buffered.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<ArrayBuffer | null> {
	const declared = request.headers.get("content-length");
	if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > limit) {
		await request.body?.cancel().catch(() => undefined);
		return null;
	}
	if (!request.body) return new ArrayBuffer(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body.buffer;
}
