/**
 * Deadlines for calls to services we do not run (Cloudflare API, AWS, Resend,
 * push services). Without one, a provider that accepts the connection and never
 * answers holds a Worker request or a queue job until the platform kills it.
 * `AbortSignal.timeout` works on Workers and Node, and the deadline covers
 * reading the body too, because the same signal aborts the stream.
 */

/** Control-plane calls: DNS, domain and webhook setup, identity checks. */
export const API_TIMEOUT_MS = 30_000;
/** Sending a message, which may carry attachments up to the provider's size limit. */
export const SEND_TIMEOUT_MS = 60_000;
/** Moving a whole raw message (up to ~40 MB) to or from object storage. */
export const TRANSFER_TIMEOUT_MS = 120_000;
/** One push notification; the next one will carry the news if this one is late. */
export const PUSH_TIMEOUT_MS = 10_000;

/** `init` with a signal that aborts after `timeoutMs`, keeping any signal the caller passed. */
export function withTimeout<T extends RequestInit | undefined>(init: T, timeoutMs: number): RequestInit {
	const deadline = AbortSignal.timeout(timeoutMs);
	const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
	return { ...init, signal };
}

/** True for the rejection `AbortSignal.timeout` produces (a DOMException named TimeoutError). */
export function isTimeoutError(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

export function timeoutMessage(service: string, timeoutMs: number): string {
	return `${service} did not answer within ${Math.round(timeoutMs / 1000)} seconds`;
}
