import { signAwsRequest } from "@/lib/aws/sigv4";
import { xmlTag } from "@/lib/aws/xml";
import type { AwsConfig } from "@/lib/aws/aws-types";
import { API_TIMEOUT_MS, isTimeoutError, timeoutMessage, withTimeout } from "@/lib/http/fetch-timeout";

export class AwsError extends Error {
	constructor(message: string, readonly status: number, readonly code: string) {
		super(message);
	}

	get accessDenied(): boolean {
		return /AccessDenied|UnauthorizedOperation|AuthorizationError|NotAuthorized|Forbidden/i.test(this.code) || this.status === 403;
	}
}

async function parseError(response: Response): Promise<AwsError> {
	const text = await response.text().catch(() => "");
	let code = response.headers.get("x-amzn-errortype")?.split(":")[0] ?? "";
	let message = "";
	try {
		const json = JSON.parse(text) as { __type?: string; message?: string; Message?: string };
		code ||= json.__type?.split("#").pop() ?? "";
		message = json.message ?? json.Message ?? "";
	} catch {
		code ||= xmlTag(text, "Code") ?? "";
		message = xmlTag(text, "Message") ?? "";
	}
	return new AwsError(message || `AWS request failed (${response.status})`, response.status, code || `HTTP${response.status}`);
}

export type AwsRequest = {
	config: AwsConfig;
	service: string;
	/** Defaults to `${service}.${region}.amazonaws.com`. */
	host?: string;
	method?: string;
	path?: string;
	query?: Record<string, string>;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	/** Region used to sign; defaults to the config's. */
	region?: string;
	/**
	 * Deadline for the response and, when the caller reads it before then, its body.
	 * None by default: B2Bucket streams object bodies through this to clients for as
	 * long as a download takes. Calls that buffer the body pass one.
	 */
	timeoutMs?: number;
};

/** A deadline that passed surfaces as an AwsError, which every caller already handles. */
export function awsTimeoutError(timeoutMs: number): AwsError {
	return new AwsError(timeoutMessage("AWS", timeoutMs), 504, "RequestTimeout");
}

/** Runs `read` and turns a timeout during it into an AwsError. */
export async function withAwsTimeout<T>(timeoutMs: number, read: () => Promise<T>): Promise<T> {
	try {
		return await read();
	} catch (error) {
		if (isTimeoutError(error)) throw awsTimeoutError(timeoutMs);
		throw error;
	}
}

export async function awsRequest(request: AwsRequest): Promise<Response> {
	const { config, service } = request;
	const region = request.region ?? config.region;
	const url = new URL(`https://${request.host ?? `${service}.${region}.amazonaws.com`}${request.path ?? "/"}`);
	for (const [name, value] of Object.entries(request.query ?? {})) url.searchParams.set(name, value);
	const body = request.body ?? "";
	const method = request.method ?? "GET";
	const headers = await signAwsRequest({ method, url, headers: request.headers ?? {}, body, region, service, credentials: config, });
	const init: RequestInit = { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body };
	const timeoutMs = request.timeoutMs;
	if (!timeoutMs) {
		const response = await fetch(url, init);
		if (!response.ok) throw await parseError(response);
		return response;
	}
	return withAwsTimeout(timeoutMs, async () => {
		const response = await fetch(url, withTimeout(init, timeoutMs));
		if (!response.ok) throw await parseError(response);
		return response;
	});
}

/** AWS JSON REST (SES v2). */
export async function awsJson<T>(request: AwsRequest & { json?: unknown }): Promise<T> {
	const timeoutMs = request.timeoutMs ?? API_TIMEOUT_MS;
	const response = await awsRequest({
		...request,
		timeoutMs,
		body: request.json === undefined ? request.body : JSON.stringify(request.json),
		headers: { "Content-Type": "application/json", ...request.headers },
	});
	const text = await withAwsTimeout(timeoutMs, () => response.text());
	return (text ? JSON.parse(text) : {}) as T;
}

/** AWS Query protocol (STS, SNS, SES v1): form-encoded POST, XML back. */
export async function awsQuery(
	config: AwsConfig,
	service: string,
	version: string,
	action: string,
	params: Record<string, string> = {},
	options: { host?: string; signingService?: string } = {},
): Promise<string> {
	const body = new URLSearchParams({ Action: action, Version: version, ...params }).toString();
	const response = await awsRequest({
		config,
		service: options.signingService ?? service,
		host: options.host ?? `${service}.${config.region}.amazonaws.com`,
		method: "POST",
		body,
		headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
		timeoutMs: API_TIMEOUT_MS,
	});
	return withAwsTimeout(API_TIMEOUT_MS, () => response.text());
}
