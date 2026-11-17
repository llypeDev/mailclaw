import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { assessStoredAttachment } from "@/lib/email/attachments";
import { getInlineContentType } from "@/lib/http/content-type";
import { etagMatches, formatContentRange, ifRangeAllows, parseByteRange } from "@/lib/http/object-cache";
import { findReadableAttachment } from "./lookup";
import type { AttachmentRouteParams } from "./types";
import { ATTACHMENT_CACHE_CONTROL, getAttachmentContentDisposition } from "./utils";

export async function GET(request: Request, { params }: AttachmentRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return new Response("Unauthorized", { status: 401 });

	const { attachmentId, messageId } = await params;
	const attachment = await findReadableAttachment(env, user, messageId, attachmentId);
	if (!attachment) return new Response("Not found", { status: 404 });

	const url = new URL(request.url);
	const previewRequested = url.searchParams.get("preview") === "1";
	const downloadRequested = url.searchParams.get("download") === "1";
	// The sender chooses both the type and the disposition, so only types that cannot run script ever render here.
	// The sandbox below is not enough on its own: on the Node runtime Next.js keeps the global CSP from next.config
	// and drops a route's own Content-Security-Policy.
	const inlineType = downloadRequested ? null : getInlineContentType(attachment.contentType);
	const inline = inlineType !== null && (attachment.disposition === "inline" || previewRequested);
	const riskRequested = url.searchParams.get("risk") === "1";
	// Types that run code, carry macros or hide other files are downloaded only after the user has seen why.
	// The check reads at most two small ranges of a ZIP and never opens the whole object.
	if (riskRequested || (!inline && url.searchParams.get("acknowledge") !== "1")) {
		const risk = await assessStoredAttachment(env, { filename: attachment.filename, type: attachment.contentType, size: attachment.size, r2Key: attachment.r2Key });
		if (riskRequested) return Response.json(risk, { headers: { "Cache-Control": "private, no-store" } });
		if (risk.level !== "ok") {
			return Response.json({ error: "This file is flagged. Review the warning before downloading it.", risk }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
		}
	}

	const headers = new Headers();
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set(
		"Content-Security-Policy",
		"default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; sandbox",
	);
	headers.set("Cache-Control", ATTACHMENT_CACHE_CONTROL);

	// Revalidation needs only the stored ETag, so read the metadata, not the body.
	const ifNoneMatch = request.headers.get("If-None-Match");
	if (ifNoneMatch) {
		const head = await env.BUCKET.head(attachment.r2Key);
		if (!head) return new Response("Not found", { status: 404 });
		if (etagMatches(ifNoneMatch, head.httpEtag)) {
			headers.set("ETag", head.httpEtag);
			return new Response(null, { status: 304, headers });
		}
	}

	const range = parseByteRange(request.headers.get("Range"), attachment.size);
	if (range === "unsatisfiable") {
		headers.set("Content-Range", `bytes */${attachment.size}`);
		return new Response(null, { status: 416, headers });
	}
	let object = await env.BUCKET.get(attachment.r2Key, range ? { range } : undefined);
	if (!object) return new Response("Not found", { status: 404 });
	let partial = range;
	if (partial && !ifRangeAllows(request.headers.get("If-Range"), object.httpEtag)) {
		// The client's partial copy is stale: send the whole current object instead.
		await object.body.cancel().catch(() => undefined);
		object = await env.BUCKET.get(attachment.r2Key);
		if (!object) return new Response("Not found", { status: 404 });
		partial = null;
	}

	object.writeHttpMetadata(headers);
	headers.set("Content-Type", (inline && inlineType) || "application/octet-stream");
	headers.set("Content-Disposition", getAttachmentContentDisposition(attachment.filename, inline));
	// writeHttpMetadata can copy a stored Cache-Control; ours wins.
	headers.set("Cache-Control", ATTACHMENT_CACHE_CONTROL);
	headers.set("ETag", object.httpEtag);
	headers.set("Accept-Ranges", "bytes");
	if (partial) {
		headers.set("Content-Length", String(partial.length));
		headers.set("Content-Range", formatContentRange(partial, attachment.size));
		return new Response(object.body, { status: 206, headers });
	}
	headers.set("Content-Length", String(attachment.size));
	return new Response(object.body, { headers });
}
