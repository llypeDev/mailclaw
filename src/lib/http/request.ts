import { RequestBodyTooLargeError } from "./errors";

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
	const contentLength = Number(request.headers.get("content-length") ?? 0);
	if (contentLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");

	const body = await request.arrayBuffer();
	if (body.byteLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
	if (body.byteLength === 0) return {} as T;

	return JSON.parse(new TextDecoder().decode(body)) as T;
}

/** A plain JSON object: not null, not an array, not a string or number. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The request's JSON body when it is an object, or the response to send instead:
 * 400 `Invalid JSON body` for malformed JSON or a body that is not an object (null,
 * an array, a string, a number), 413 past `maxBytes`. An empty body reads as `{}`,
 * as in readJsonBody. The cast to `T` is the caller's; validate fields as before.
 */
export async function readJsonObjectBody<T extends object = Record<string, unknown>>(
	request: Request,
	maxBytes = Number.POSITIVE_INFINITY,
): Promise<{ body: T } | { response: Response }> {
	let body: unknown;
	try {
		body = await readJsonBody(request, maxBytes);
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) return { response: Response.json({ error: "Request body is too large" }, { status: 413 }) };
		return { response: Response.json({ error: "Invalid JSON body" }, { status: 400 }) };
	}
	if (!isJsonObject(body)) return { response: Response.json({ error: "Invalid JSON body" }, { status: 400 }) };
	return { body: body as T };
}

export function assertRequestSize(request: Request, maxBytes: number): void {
	const contentLength = Number(request.headers.get("content-length") ?? 0);
	if (contentLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");
}

export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
	assertRequestSize(request, maxBytes);
	const body = await request.arrayBuffer();
	if (body.byteLength > maxBytes) throw new RequestBodyTooLargeError("Request body is too large");

	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body,
	}).formData();
}
