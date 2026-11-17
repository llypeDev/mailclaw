export type RemoteBodyLimits = {
	maxBytes: number;
	/** Aborted when the whole request's deadline passes. */
	signal: AbortSignal;
	tooLarge: () => Error;
	timedOut: () => Error;
};

type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

/** Reads one chunk, giving up when the deadline passes even if the upstream stream ignores the abort. */
function readBeforeDeadline(reader: BodyReader, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		reader.read().then(
			(result) => { signal.removeEventListener("abort", onAbort); resolve(result); },
			(error) => { signal.removeEventListener("abort", onAbort); reject(error); },
		);
	});
}

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array<ArrayBuffer> {
	const joined = new Uint8Array(head.byteLength + tail.byteLength);
	joined.set(head, 0);
	joined.set(tail, head.byteLength);
	return joined;
}

/**
 * Reads whole chunks until `wanted(prefix)` bytes have arrived or the body ends, so a
 * signature can be checked before committing to a response. Throws `tooLarge` when the
 * prefix alone passes the cap; deadline and upstream errors propagate as they are.
 */
export async function readBodyPrefix(
	reader: BodyReader,
	wanted: (prefix: Uint8Array) => number,
	limits: RemoteBodyLimits,
): Promise<{ prefix: Uint8Array<ArrayBuffer>; done: boolean }> {
	let prefix = new Uint8Array(0);
	while (prefix.byteLength < wanted(prefix)) {
		const { done, value } = await readBeforeDeadline(reader, limits.signal);
		if (done) return { prefix, done: true };
		if (prefix.byteLength + value.byteLength > limits.maxBytes) throw limits.tooLarge();
		prefix = concat(prefix, value);
	}
	return { prefix, done: false };
}

/**
 * The rest of the body as a stream that starts with the bytes already read. It counts
 * every byte and errors (cancelling the upstream body) once the total passes the cap or
 * the deadline passes; by then the 200 is sent, so the client sees a truncated body.
 * `onSettled` runs exactly once, when the body ends, fails or is cancelled by the consumer.
 */
export function streamLimitedBody(
	reader: BodyReader,
	prefix: Uint8Array,
	done: boolean,
	limits: RemoteBodyLimits,
	onSettled: () => void,
): ReadableStream<Uint8Array> {
	let size = prefix.byteLength;
	let settled = false;
	const settle = () => {
		if (settled) return;
		settled = true;
		onSettled();
	};
	return new ReadableStream<Uint8Array>({
		start(controller) {
			if (prefix.byteLength) controller.enqueue(prefix);
			if (done) {
				controller.close();
				settle();
			}
		},
		async pull(controller) {
			try {
				const result = await readBeforeDeadline(reader, limits.signal);
				if (result.done) {
					controller.close();
					settle();
					return;
				}
				size += result.value.byteLength;
				if (size > limits.maxBytes) throw limits.tooLarge();
				controller.enqueue(result.value);
			} catch (error) {
				settle();
				reader.cancel().catch(() => undefined);
				controller.error(limits.signal.aborted ? limits.timedOut() : error);
			}
		},
		cancel(reason) {
			settle();
			return reader.cancel(reason).catch(() => undefined);
		},
	});
}
