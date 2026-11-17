/**
 * S3 (and Backblaze's S3 API) lower-cases `x-amz-meta-*` header names, while R2 and the Node file
 * bucket keep customMetadata keys as written. To round-trip the original spelling, the keys that
 * are not already lower-case are listed, comma-separated, in one extra metadata entry. Header names
 * cannot contain commas, so the list needs no escaping. Objects written without it (or when it would
 * not fit) read back with lower-cased keys, as before.
 */
export const METADATA_KEY_CASE_ENTRY = "mailclaw-key-case";

/** S3's limit on user metadata: the UTF-8 bytes of every key and value, summed. */
export const MAX_USER_METADATA_BYTES = 2048;

const utf8Length = (value: string) => new TextEncoder().encode(value).byteLength;

function metadataBytes(entries: Record<string, string>): number {
	let total = 0;
	for (const [name, value] of Object.entries(entries)) total += utf8Length(name) + utf8Length(value);
	return total;
}

/** customMetadata as the entries to send (names lower-cased, without the `x-amz-meta-` prefix). */
export function encodeCustomMetadata(metadata: Record<string, string> = {}): Record<string, string> {
	const entries: Record<string, string> = {};
	const spelling = new Map<string, string>();
	for (const [name, value] of Object.entries(metadata)) {
		const lower = name.toLowerCase();
		entries[lower] = value;
		spelling.set(lower, name);
	}
	const mixedCase = [...spelling.entries()].filter(([lower, name]) => lower !== name).map(([, name]) => name);
	// A caller key that takes the entry's own name wins; its spelling list is then left out.
	if (!mixedCase.length || METADATA_KEY_CASE_ENTRY in entries) return entries;
	const withSpelling = { ...entries, [METADATA_KEY_CASE_ENTRY]: mixedCase.join(",") };
	return metadataBytes(withSpelling) <= MAX_USER_METADATA_BYTES ? withSpelling : entries;
}

/**
 * Reads back what `encodeCustomMetadata` wrote, from entries whose names arrive lower-cased. The
 * spelling entry is used only when every name it lists matches another entry, so a caller's own
 * key that happens to share its name is returned untouched.
 */
export function decodeCustomMetadata(entries: Record<string, string>): Record<string, string> {
	const listed = entries[METADATA_KEY_CASE_ENTRY];
	const spelling = new Map<string, string>();
	if (listed !== undefined) {
		const names = listed.split(",").map((name) => name.trim()).filter(Boolean);
		const valid = names.length > 0 && names.every((name) => {
			const lower = name.toLowerCase();
			return lower !== METADATA_KEY_CASE_ENTRY && Object.prototype.hasOwnProperty.call(entries, lower);
		});
		if (valid) for (const name of names) spelling.set(name.toLowerCase(), name);
	}
	const consumed = spelling.size > 0;
	const metadata: Record<string, string> = {};
	for (const [name, value] of Object.entries(entries)) {
		if (consumed && name === METADATA_KEY_CASE_ENTRY) continue;
		metadata[spelling.get(name) ?? name] = value;
	}
	return metadata;
}
