import { readFileSync } from "node:fs";
import { SMTPServer } from "smtp-server";
import type { SMTPServerSession } from "smtp-server";
import { intakeIncomingMail } from "@/lib/email/intake";
import { inboundAttachmentLimitReasonFromRaw } from "@/lib/email/inbound-attachments";
import { recordRuleMatch, resolveInboundAddress } from "@/lib/email/routing";
import { isPublicIpv4 } from "@/lib/spam/domain-utils";
import { getDb } from "@/db";
import { domains } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifySmtpAuthentication } from "./smtp-auth";
import {
	CompletedWork,
	deliverToRecipients,
	forwardKey,
	messageFingerprint,
	parseHeaders,
	smtpDataReply,
	UNTRUSTED_HEADERS,
	withPrependedHeaders,
} from "./smtp-utils";
import type { Mailer } from "./mailer";

export { parseHeaders } from "./smtp-utils";

const MAX_CLIENTS = 100;
const MAX_CONNECTIONS_PER_IP = 10;
const MAX_RECIPIENTS = 50;
const SOCKET_TIMEOUT_MS = 60_000;

type SmtpError = Error & { responseCode: number };

function smtpError(message: string, responseCode: number): SmtpError {
	return Object.assign(new Error(message), { responseCode });
}

/**
 * The RCPT TO answer for one recipient. Domain block rules match only the
 * envelope addresses, so they are decided here and the sender gets a 550 for
 * that recipient alone; an address on one of our domains that resolves to
 * nothing is refused the same way instead of being accepted and then dropped by
 * the queue consumer. Null accepts the recipient.
 */
async function checkRecipient(env: CloudflareEnv, address: string, mailFrom: string): Promise<SmtpError | null> {
	const db = getDb(env);
	const hostname = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
	const [domain] = await db.select({ id: domains.id }).from(domains).where(eq(domains.hostname, hostname)).limit(1);
	if (!domain) return smtpError("Relay access denied", 550);
	const decision = await resolveInboundAddress(db, address, mailFrom);
	if (!decision) return smtpError("No such user here", 550);
	if (decision.action === "reject") {
		if (decision.ruleId) await recordRuleMatch(db, decision.ruleId).catch(() => undefined);
		return smtpError(decision.rejectReason ?? "Message rejected by routing rule", 550);
	}
	return null;
}

/**
 * Receive mail directly on port 25 (or wherever SMTP_INBOUND_PORT points).
 * One inbound connection per message; each envelope recipient is handed to
 * the same intake the Cloudflare handler uses.
 *
 * Refusals happen per recipient at RCPT TO (unknown domain or address, domain
 * block rule). After DATA, SMTP has one answer for the whole message: see
 * `smtpDataReply` for how per-recipient outcomes combine, and `CompletedWork`
 * for why a 451 retry does not store or forward twice.
 */
export function startSmtpListener(
	env: CloudflareEnv,
	mailer: Mailer,
	options: { port: number; host?: string; maxSize: number; hostname?: string; tls: { keyPath: string; certPath: string } | null },
) {
	// STARTTLS is only offered with a real certificate; smtp-server's built-in
	// one has a public private key, and advertising it would mislead senders.
	const connectionsByIp = new Map<string, number>();
	// Only sessions that were admitted are counted, so rejected ones cannot decrement on close.
	const admittedSessions = new Set<string>();
	const completed = new CompletedWork();
	const server = new SMTPServer({
		maxClients: MAX_CLIENTS,
		socketTimeout: SOCKET_TIMEOUT_MS,
		onConnect(session, callback) {
			const ip = session.remoteAddress;
			const count = (connectionsByIp.get(ip) ?? 0) + 1;
			// maxClients in smtp-server admits one connection past the limit, so enforce it here too.
			if (count > MAX_CONNECTIONS_PER_IP || admittedSessions.size >= MAX_CLIENTS) {
				callback(smtpError("Too many connections", 421));
				return;
			}
			admittedSessions.add(session.id);
			connectionsByIp.set(ip, count);
			callback();
		},
		onClose(session) {
			if (!admittedSessions.delete(session.id)) return;
			const ip = session.remoteAddress;
			const count = (connectionsByIp.get(ip) ?? 1) - 1;
			if (count <= 0) connectionsByIp.delete(ip);
			else connectionsByIp.set(ip, count);
		},
		onRcptTo(address, session, callback) {
			if (session.envelope.rcptTo.length >= MAX_RECIPIENTS) {
				callback(smtpError("Too many recipients", 452));
				return;
			}
			// Decide before DATA so nothing is buffered for mail we would drop anyway.
			const mailFrom = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
			checkRecipient(env, address.address, mailFrom).then(
				(refusal) => callback(refusal ?? undefined),
				(error) => {
					console.error("SMTP recipient lookup failed", error);
					callback(smtpError("Temporary failure, try again later", 451));
				},
			);
		},
		name: options.hostname,
		authOptional: true,
		disabledCommands: options.tls ? ["AUTH"] : ["AUTH", "STARTTLS"],
		...(options.tls ? { key: readFileSync(options.tls.keyPath), cert: readFileSync(options.tls.certPath) } : {}),
		size: options.maxSize,
		banner: "Mailclaw",
		onData(stream, session: SMTPServerSession, callback) {
			const chunks: Buffer[] = [];
			let received = 0;
			stream.on("data", (chunk: Buffer) => {
				// Stop buffering once over the limit; the 552 is sent when the stream ends.
				received += chunk.length;
				if (received <= options.maxSize) chunks.push(chunk);
				else chunks.length = 0;
			});
			stream.on("end", async () => {
				if (stream.sizeExceeded) {
					callback(smtpError("Message exceeds size limit", 552));
					return;
				}
				const raw = Buffer.concat(chunks);
				let attachmentLimitReason: string | null;
				try {
					attachmentLimitReason = await inboundAttachmentLimitReasonFromRaw(toArrayBuffer(raw));
				} catch (error) {
					console.error("SMTP attachment inspection failed", error);
					callback(smtpError("Temporary failure, try again later", 451));
					return;
				}
				if (attachmentLimitReason) {
					callback(smtpError(attachmentLimitReason, 552));
					return;
				}
				const from = session.envelope.mailFrom ? session.envelope.mailFrom.address : "";
				const headers = parseHeaders(raw);
				// No SPF/DKIM/DMARC verification happens here, so anything the sender wrote is untrusted.
				for (const name of UNTRUSTED_HEADERS) delete headers[name];
				const senderIp = isPublicIpv4(session.remoteAddress) ? session.remoteAddress : undefined;
				const verdicts = await verifySmtpAuthentication(raw, {
					ip: session.remoteAddress,
					helo: session.hostNameAppearsAs,
					sender: from,
					mta: options.hostname,
				});
				const fingerprint = messageFingerprint(raw, from);
				const outcomes = await deliverToRecipients(
					session.envelope.rcptTo.map((recipient) => recipient.address),
					fingerprint,
					completed,
					async (to) => {
						const result = await intakeIncomingMail(
							env,
							{ from, to, raw: toArrayBuffer(raw), headers, senderIp, verdicts },
							{
								forward: async (destination, extraHeaders) => {
									// A retried transaction must not send a forward that already went out.
									const key = forwardKey(fingerprint, to, destination);
									if (completed.has(key)) return true;
									// The loop-guard marker rides on the forwarded copy, as message.forward() adds it on Workers.
									const sent = await mailer.sendRaw(from, destination, withPrependedHeaders(raw, extraHeaders));
									if (sent) completed.add(key);
									return sent;
								},
							},
						);
						return { rejected: result.action === "reject" ? result.reason : null };
					},
				);
				for (const outcome of outcomes) {
					if (outcome.outcome === "rejected") console.warn(`SMTP: refused ${outcome.recipient} after DATA: ${outcome.reason}`);
				}
				const reply = smtpDataReply(outcomes);
				callback(reply.code === 250 ? undefined : smtpError(reply.message, reply.code));
			});
		},
	});
	server.on("error", (error) => console.error("SMTP listener error", error));
	server.listen(options.port, options.host ?? "0.0.0.0", () => {
		console.log(`SMTP inbound listening on ${options.host ?? "0.0.0.0"}:${options.port}`);
	});
	return server;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
	return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}
