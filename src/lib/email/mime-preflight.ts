/**
 * Cheap, linear raw-byte scan that rejects MIME shapes known to make the parser burn CPU or
 * memory (header floods, thousands of parts, endless nested message/rfc822, line floods in text parts).
 * Runs before any decode, so a hostile message costs one pass over the bytes.
 */
export const MIME_LIMITS = {
	maxHeaderBytes: 64 * 1024,
	maxBoundaryLines: 1_000,
	maxNestedMessages: 20,
	// Lines outside base64 parts: postal-mime spends memory per line there, so 262k lines of
	// any length exhaust a 128 MB heap. Base64 attachment lines are chunked and stay cheap.
	maxTextLines: 40_000,
	maxNestingDepth: 20,
} as const;

const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const DASH = 45;
const MESSAGE_RFC822 = "message/rfc822";

function startsWithAscii(bytes: Uint8Array, start: number, end: number, prefix: string): boolean {
	if (end - start < prefix.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if ((bytes[start + i] | 0x20) !== prefix.charCodeAt(i)) return false;
	}
	return true;
}

function lineContainsAscii(bytes: Uint8Array, start: number, end: number, needle: string): boolean {
	const limit = Math.min(end, start + 256) - needle.length;
	for (let i = start; i <= limit; i++) {
		let matched = true;
		for (let j = 0; j < needle.length; j++) {
			if ((bytes[i + j] | 0x20) !== needle.charCodeAt(j)) {
				matched = false;
				break;
			}
		}
		if (matched) return true;
	}
	return false;
}

export function mimePreflightReason(raw: ArrayBuffer | Uint8Array): string | null {
	return scanMime(raw, null).reason;
}

export type MimeAttachmentScan = {
	reason: string | null;
	/** Parts postal-mime would return as attachments, counted up to `maxAttachments + 1`. */
	attachments: number;
};

/**
 * `mimePreflightReason` plus a count of the parts postal-mime (as `parseRawMime` configures it)
 * would turn into attachments, in the same single pass and without decoding any body. It follows
 * postal-mime's own structure rules: only declared boundaries split parts, the last Content-Type
 * and the first Content-Disposition of a header block count, every leaf that is not inline
 * text/plain or text/html is an attachment, and message/rfc822 is a leaf (forceRfc822Attachments).
 * Shapes it cannot follow (RFC 2231 continued boundaries, headers it does not recognise) are
 * counted low, never high, so the queue's full parse stays the authoritative check.
 */
export function scanMimeAttachments(raw: ArrayBuffer | Uint8Array, maxAttachments: number): MimeAttachmentScan {
	return scanMime(raw, maxAttachments);
}

type ScanBoundary = { value: Uint8Array; digest: boolean; depth: number };

type ScanNode = {
	inHeaders: boolean;
	parentIsDigest: boolean;
	depth: number;
	headerBytes: number;
	/** The last Content-Type header seen so far, unfolded. */
	contentType: string | null;
	/** The first Content-Disposition header. */
	disposition: string | null;
	/** Which header a folded continuation line extends. */
	continuing: "type" | "disposition" | null;
};

const SPACE = 32;
const TAB = 9;
const COLON = 58;
const headerDecoder = new TextDecoder();
const boundaryEncoder = new TextEncoder();

function newScanNode(parentIsDigest: boolean, depth: number): ScanNode {
	return { inHeaders: true, parentIsDigest, depth, headerBytes: 0, contentType: null, disposition: null, continuing: null };
}

/** Header name match that, like postal-mime, tolerates blanks before the colon. Returns the value offset. */
function headerValueStart(bytes: Uint8Array, start: number, end: number, name: string): number {
	if (!startsWithAscii(bytes, start, end, name)) return -1;
	let index = start + name.length;
	while (index < end && (bytes[index] === SPACE || bytes[index] === TAB)) index++;
	return index < end && bytes[index] === COLON ? index + 1 : -1;
}

/** postal-mime's stripComments: parenthesised comments outside quotes are dropped. */
function stripHeaderComments(value: string): string {
	let result = "";
	let depth = 0;
	let escaped = false;
	let inQuote = false;
	for (const chr of value) {
		if (escaped) {
			if (depth === 0) result += chr;
			escaped = false;
			continue;
		}
		if (chr === "\\") {
			escaped = true;
			if (depth === 0) result += chr;
			continue;
		}
		if (chr === "\"" && depth === 0) {
			inQuote = !inQuote;
			result += chr;
			continue;
		}
		if (!inQuote && chr === "(") {
			depth++;
			continue;
		}
		if (!inQuote && chr === ")" && depth > 0) {
			depth--;
			continue;
		}
		if (depth === 0) result += chr;
	}
	return result;
}

/** postal-mime's parseStructuredHeader, reduced to the value and plain (non-continued) parameters. */
export function parseStructuredMimeHeader(header: string): { value: string; params: Record<string, string> } {
	const str = stripHeaderComments(header.replace(/\s+/g, " ").trim());
	let value = "";
	let key: string | null = null;
	let stage: "value" | "key" = "value";
	let quote = false;
	let escaped = false;
	let main = "";
	const params: Record<string, string> = {};
	for (const chr of str) {
		if (stage === "key") {
			if (chr === "=") {
				key = value.trim().toLowerCase();
				stage = "value";
				value = "";
			} else {
				value += chr;
			}
			continue;
		}
		if (escaped) {
			value += chr;
		} else if (chr === "\\") {
			escaped = true;
			continue;
		} else if (quote && chr === "\"") {
			quote = false;
		} else if (!quote && chr === "\"") {
			quote = true;
		} else if (!quote && chr === ";") {
			if (key === null) main = value.trim();
			else params[key] = value.trim();
			stage = "key";
			value = "";
		} else {
			value += chr;
		}
		escaped = false;
	}
	value = value.trim();
	if (stage === "value") {
		if (key === null) main = value;
		else params[key] = value;
	}
	return { value: main.toLowerCase(), params };
}

function scanMime(raw: ArrayBuffer | Uint8Array, maxAttachments: number | null): MimeAttachmentScan {
	const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
	let boundaryLines = 0;
	let nestedMessages = 0;
	let textLines = 0;
	let headerEnded = false;
	// Tracks the current part's header block and transfer encoding to tell base64 from text lines.
	let inPartHeaders = true;
	let partIsBase64 = false;

	// Structure tracking for the attachment count; idle when no count was asked for.
	const counting = maxAttachments !== null;
	const boundaries: ScanBoundary[] = [];
	let node = newScanNode(false, 0);
	let attachments = 0;
	const closeHeaders = (current: ScanNode, openChildren: boolean) => {
		current.inHeaders = false;
		const type = current.contentType === null
			? current.parentIsDigest ? "message/rfc822" : "text/plain"
			: parseStructuredMimeHeader(current.contentType).value;
		if (type.startsWith("multipart/")) {
			if (!openChildren || current.contentType === null) return;
			const boundary = parseStructuredMimeHeader(current.contentType).params.boundary;
			if (boundary) boundaries.push({ value: boundaryEncoder.encode(boundary), digest: type === "multipart/digest", depth: current.depth });
			return;
		}
		const disposition = current.disposition === null ? "" : parseStructuredMimeHeader(current.disposition).value;
		if ((type === "text/plain" || type === "text/html") && disposition !== "attachment") return;
		attachments++;
	};
	/** postal-mime's boundary test: the innermost open boundary first, optional "--", then only blanks. */
	const matchBoundary = (start: number, end: number): { index: number; terminator: boolean } | null => {
		for (let index = boundaries.length - 1; index >= 0; index--) {
			const value = boundaries[index].value;
			if (end - start < value.length + 2) continue;
			let matches = true;
			for (let j = 0; j < value.length; j++) {
				if (bytes[start + 2 + j] !== value[j]) {
					matches = false;
					break;
				}
			}
			if (!matches) continue;
			let tail = start + 2 + value.length;
			let terminator = false;
			if (end - tail >= 2 && bytes[tail] === DASH && bytes[tail + 1] === DASH) {
				terminator = true;
				tail += 2;
			}
			let blanksOnly = true;
			for (let j = tail; j < end; j++) {
				if (bytes[j] !== SPACE && bytes[j] !== TAB) {
					blanksOnly = false;
					break;
				}
			}
			if (blanksOnly) return { index, terminator };
		}
		return null;
	};
	const result = (reason: string | null): MimeAttachmentScan => ({ reason, attachments });

	let lineStart = 0;
	while (lineStart < bytes.length) {
		if (counting && partIsBase64 && !inPartHeaders && !node.inHeaders) {
			// The base64 alphabet has no "-", so inside a base64 body the next line that can change
			// any state is the next one starting with a dash: jump there with a native search instead
			// of walking every line (this is what keeps a 20 MB attachment cheap). The only thing
			// skipped is the nested-message heuristic on lines a hostile part mislabels as base64;
			// the queue's parse runs the full preflight again.
			let dash = bytes.indexOf(DASH, lineStart);
			while (dash > lineStart && bytes[dash - 1] !== NEWLINE) dash = bytes.indexOf(DASH, dash + 1);
			if (dash === -1) break;
			lineStart = dash;
		}
		let lineEnd = bytes.indexOf(NEWLINE, lineStart);
		if (lineEnd === -1) lineEnd = bytes.length;
		let contentEnd = lineEnd;
		if (contentEnd > lineStart && bytes[contentEnd - 1] === CARRIAGE_RETURN) contentEnd--;

		const isBoundary = contentEnd - lineStart > 2 && bytes[lineStart] === DASH && bytes[lineStart + 1] === DASH;
		if (counting) {
			const boundary = isBoundary && boundaries.length ? matchBoundary(lineStart, contentEnd) : null;
			if (boundary) {
				// The open part ends here; a part still in its headers is finalised as postal-mime does.
				if (node.inHeaders) closeHeaders(node, false);
				const { digest, depth } = boundaries[boundary.index];
				boundaries.length = boundary.terminator ? boundary.index : boundary.index + 1;
				// After a terminator the lines are the parent's epilogue, which nothing reads.
				node = boundary.terminator ? { ...newScanNode(false, depth), inHeaders: false } : newScanNode(digest, depth + 1);
				// postal-mime throws on both of these; the old full parse bounced them as unparseable.
				if (node.depth > MIME_LIMITS.maxNestingDepth) return result("Message rejected: MIME parts are nested too deeply.");
			} else if (node.inHeaders) {
				if (contentEnd === lineStart) {
					closeHeaders(node, true);
				} else if ((node.headerBytes += contentEnd - lineStart) > MIME_LIMITS.maxHeaderBytes) {
					return result("Message rejected: a MIME part's header block exceeds 64 KiB.");
				} else if (bytes[lineStart] === SPACE || bytes[lineStart] === TAB) {
					const continuation = headerDecoder.decode(bytes.subarray(lineStart, contentEnd));
					if (node.continuing === "type") node.contentType += ` ${continuation}`;
					else if (node.continuing === "disposition") node.disposition += ` ${continuation}`;
				} else {
					node.continuing = null;
					const typeStart = headerValueStart(bytes, lineStart, contentEnd, "content-type");
					if (typeStart !== -1) {
						node.contentType = headerDecoder.decode(bytes.subarray(typeStart, contentEnd));
						node.continuing = "type";
					} else if (node.disposition === null) {
						const dispositionStart = headerValueStart(bytes, lineStart, contentEnd, "content-disposition");
						if (dispositionStart !== -1) {
							node.disposition = headerDecoder.decode(bytes.subarray(dispositionStart, contentEnd));
							node.continuing = "disposition";
						}
					}
				}
			}
			if (attachments > maxAttachments) return result(null);
		}

		if (contentEnd === lineStart) {
			headerEnded = true;
			inPartHeaders = false;
		} else if (!headerEnded && lineEnd > MIME_LIMITS.maxHeaderBytes) {
			return result("Message rejected: header block exceeds 64 KiB.");
		} else if (isBoundary) {
			if (++boundaryLines > MIME_LIMITS.maxBoundaryLines) {
				return result("Message rejected: too many MIME parts.");
			}
			inPartHeaders = true;
			partIsBase64 = false;
			lineStart = lineEnd + 1;
			continue;
		} else {
			// Not limited to part headers: a nested message restarts its own header block.
			if (startsWithAscii(bytes, lineStart, contentEnd, "content-type:") && lineContainsAscii(bytes, lineStart, contentEnd, MESSAGE_RFC822)) {
				if (++nestedMessages > MIME_LIMITS.maxNestedMessages) {
					return result("Message rejected: too many nested messages.");
				}
			}
			if (inPartHeaders && startsWithAscii(bytes, lineStart, contentEnd, "content-transfer-encoding:") && lineContainsAscii(bytes, lineStart, contentEnd, "base64")) {
				partIsBase64 = true;
			}
		}
		if (!inPartHeaders && !partIsBase64 && ++textLines > MIME_LIMITS.maxTextLines) {
			return result("Message rejected: malformed MIME structure (too many lines).");
		}
		lineStart = lineEnd + 1;
	}
	// A part whose header block never ended is still finalised (and can be an attachment).
	if (counting && node.inHeaders) closeHeaders(node, false);
	return result(null);
}
