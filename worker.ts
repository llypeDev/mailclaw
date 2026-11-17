import { withDatabase } from "./src/db/with-database";
import { withStorage } from "./src/lib/storage";
import vinextHandler from "vinext/server/fetch-handler";
import {
	processInboundMessage,
	storeRawToR2,
	type InboundQueueMessage,
} from "./src/lib/email/inbound";
import { processOutboundQueue, sweepStuckOutboundJobs, type OutboundQueueMessage } from "./src/lib/email/send";
import {
	isAgentDraftMessage,
	isImportJobMessage,
	isInboundQueueMessage,
	isWebhookRetryMessage,
	queueKindOf,
	withD1BookmarkCookie,
	withD1ReadSession,
} from "./worker-utils";
import { runWithD1Session } from "./src/lib/d1-session-context";
import { sweepOrphanedRawMail } from "./src/lib/email/raw-sweeper";
import { processImportJob, sweepImportJobs } from "./src/lib/import/jobs";
import { processWebhookRetry, type WebhookRetryMessage } from "./src/lib/email/webhooks";
import { resolveIncomingMail, forwardMessage } from "./src/lib/email/incoming";
import { inboundRouteFromDecision } from "./src/lib/email/inbound-route-utils";
import { getUserFromSession } from "./src/lib/auth/session";
import { getSessionTokenFromRequest } from "./src/lib/realtime/utils";
import { inboundAttachmentLimitReasonFromScan } from "./src/lib/email/inbound-attachments";
import { hasValidSessionMutationOrigin, rejectCrossSiteSessionMutation } from "./src/lib/auth/origin";
import {
	getAccountForwardingDestination,
	isForwardedMarkerValid,
	MAILCLAW_FORWARDED_HEADER,
} from "./src/lib/email/account-forwarding";
import { runScheduledDatabaseBackup } from "./src/lib/backups/runner";
import { processAgentDraftJob } from "./src/lib/agent/jobs/utils";
import { runAgentMaintenance } from "./src/lib/agent/maintenance";
import { runTrashRetention } from "./src/lib/email/trash-retention";
import { runDriveTrashRetention } from "./src/lib/drive/retention";
import { runAccountRetention } from "./src/lib/accounts/deletion";
import { runJmapChangeRetention } from "./src/lib/jmap/changes";
import { runMessageCounterRebuild } from "./src/lib/messages/counters";
import { runFollowUpReminders } from "./src/lib/follow-ups/service";
import { runCalendarReminders } from "./src/lib/calendar/reminders";
import { shouldRunTrashRetention } from "./src/lib/email/trash-retention-utils";
import { runDatabaseOptimize } from "./src/lib/migrations/optimize";
import { isFinalQueueAttempt, QUEUE_DEAD_LETTER, queueRetryDelaySeconds } from "./src/lib/queues/retry-utils";
export { RealtimeHub } from "./src/lib/realtime/hub";

export default {
	async fetch(request: Request, rawEnv: CloudflareEnv, ctx: ExecutionContext) {
		// Cookie-authenticated /api mutations must come from this origin (see rejectCrossSiteSessionMutation).
		const crossSite = rejectCrossSiteSessionMutation(request);
		if (crossSite) return crossSite;
		// Reads go through a D1 session anchored at the client's bookmark cookie so D1 can serve
		// them from read replicas; email/queue/scheduled below keep primary reads on purpose.
		const d1Session = withD1ReadSession(rawEnv, request);
		const env = withDatabase(withStorage(d1Session?.env ?? rawEnv));
		const url = new URL(request.url);
		if (url.pathname === "/api/realtime") {
			if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
				return new Response("Expected WebSocket upgrade", { status: 426 });
			}
			if (!hasValidSessionMutationOrigin(request)) {
				return new Response("Invalid origin", { status: 403 });
			}

			const user = await getUserFromSession(env, getSessionTokenFromRequest(request));
			if (!user || user.disabled) {
				return new Response("Unauthorized", { status: 401 });
			}

			const hub = env.REALTIME.getByName(user.id);
			const hubRequest = new Request("https://mailclaw-realtime/connect", request);
			hubRequest.headers.set("X-Mailclaw-Realtime-User", user.id);
			return hub.fetch(hubRequest);
		}

		const response = await runWithD1Session(d1Session?.session, () => vinextHandler.fetch(request, env, ctx));
		return withD1BookmarkCookie(request, response, d1Session?.session);
	},

	async email(message: ForwardableEmailMessage, rawEnv: CloudflareEnv, _ctx: ExecutionContext) {
		const env = withDatabase(withStorage(rawEnv));
		try {
			if (message.rawSize > 25 * 1024 * 1024) {
				message.setReject("Message rejected: raw email exceeds the 25 MiB receiving limit. Send a download link instead.");
				return;
			}
			// Domain routing rules are resolved here rather than in the queue because reject and
			// forward can only be actioned on the live ForwardableEmailMessage.
			const alreadyForwarded = await isForwardedMarkerValid(env, message.headers.get(MAILCLAW_FORWARDED_HEADER));
			const decision = await resolveIncomingMail(env, message.from, message.to, {
				subject: message.headers.get("subject"),
				alreadyForwarded,
			});

			if (decision?.action === "reject") {
				message.setReject(decision.rejectReason ?? "Message rejected by routing rule");
				return;
			}
			const raw = await new Response(message.raw).arrayBuffer();
			// A linear scan, not a parse: the queue consumer parses once and re-checks every limit.
			const attachmentLimitReason = inboundAttachmentLimitReasonFromScan(raw);
			if (attachmentLimitReason) {
				message.setReject(attachmentLimitReason);
				return;
			}

			const ruleForward = decision?.action === "forward" && decision.forwardTo ? decision.forwardTo : null;
			// A forward rule drops the message unless it was explicitly asked to keep a copy, so that
			// forward has to run first: whether it went out decides whether we store. If it failed we
			// still store, so mail is never silently lost.
			if (ruleForward && !decision?.keepCopy) {
				if (await forwardMessage(env, message, ruleForward)) return;
			}

			// Order matters for retries. Throwing makes the sender retry the whole delivery, so every
			// step that can throw (the forwarding lookup, the R2 write, the enqueue) runs before any
			// forward that comes with a stored copy, and those forwards run last: forwardMessage never
			// throws, so once the copy is queued nothing can trigger a retry that would send them
			// twice. A retry before that point stores the message afresh; an object written before a
			// failed enqueue is left for the raw-mail sweeper. The key stays random rather than a
			// content hash (as intake.ts uses): hashing costs ~1 ms of CPU per MB here, and a sender's
			// retry is a new SMTP transaction whose bytes carry new trace headers, so it would not match.
			const accountForward = alreadyForwarded ? null : await getAccountForwardingDestination(env, message.to, decision);
			const rawR2Key = await storeRawToR2(env, message.from, message.to, raw);
			// The decision rides along so the consumer does not resolve the address a second time.
			const route = inboundRouteFromDecision(decision);
			const payload: InboundQueueMessage = {
				from: message.from,
				to: message.to,
				rawR2Key,
				headers: Object.fromEntries(message.headers),
				...(route ? { route } : {}),
			};
			await env.INBOUND_QUEUE.send(payload);

			if (ruleForward && decision?.keepCopy) await forwardMessage(env, message, ruleForward);
			if (accountForward) await forwardMessage(env, message, accountForward);
		} catch (err) {
			console.error("Inbound enqueue failed", err);
			// setReject bounces permanently; throwing is a temporary SMTP failure, so the sender retries.
			throw err;
		}
	},

	async queue(batch: MessageBatch, rawEnv: CloudflareEnv): Promise<void> {
		const env = withDatabase(withStorage(rawEnv));
		for (const msg of batch.messages) {
			try {
				if (isInboundQueueMessage(msg.body)) {
					await processInboundMessage(env, msg.body);
				} else if (isAgentDraftMessage(msg.body)) {
					await processAgentDraftJob(env, msg.body.jobId);
				} else if (isWebhookRetryMessage(msg.body)) {
					await processWebhookRetry(env, msg.body as WebhookRetryMessage);
				} else if (isImportJobMessage(msg.body)) {
					await processImportJob(env, { ...msg.body, attempt: msg.attempts });
				} else if (typeof msg.body === "object" && msg.body !== null && (msg.body as { kind?: unknown }).kind === "email.scheduled") {
					await processOutboundQueue(env, msg.body as OutboundQueueMessage);
				} else {
					throw new Error("Unknown queue message type");
				}
				msg.ack();
			} catch (err) {
				// Back off from msg.attempts (10 s, 30 s, 90 s ... capped) so a short outage is outlived
				// instead of burning every retry in the first minute. Once max_retries is spent, the
				// retry hands the message to the dead-letter queue configured in wrangler.jsonc.
				const kind = queueKindOf(msg.body);
				const final = isFinalQueueAttempt(kind, msg.attempts);
				const delaySeconds = queueRetryDelaySeconds(msg.attempts);
				console.error(final ? "Queue processing failed for the last time" : "Queue processing failed", {
					queue: batch.queue,
					rawR2Key: isInboundQueueMessage(msg.body) ? msg.body.rawR2Key : undefined,
					recipient: isInboundQueueMessage(msg.body) ? msg.body.to : undefined,
					attempts: msg.attempts,
					next: final ? (QUEUE_DEAD_LETTER[kind] ?? "dropped") : `retry in ${delaySeconds} s`,
					error: err,
				});
				msg.retry({ delaySeconds });
			}
		}
	},

	async scheduled(controller: ScheduledController, rawEnv: CloudflareEnv, ctx: ExecutionContext) {
		const env = withDatabase(withStorage(rawEnv));
		if (controller.cron === "0 2 * * *") ctx.waitUntil(runScheduledDatabaseBackup(env, new Date(controller.scheduledTime)));
		ctx.waitUntil(runAgentMaintenance(env));
		// Hourly, on the five-minute tick at minute 0: retention does not need 288 runs a day.
		if (shouldRunTrashRetention(controller.cron, controller.scheduledTime)) ctx.waitUntil(runTrashRetention(env, new Date(controller.scheduledTime)));
		ctx.waitUntil(runFollowUpReminders(env, new Date(controller.scheduledTime)));
		ctx.waitUntil(runCalendarReminders(env, new Date(controller.scheduledTime)));
		ctx.waitUntil(sweepImportJobs(env, new Date(controller.scheduledTime)));
		ctx.waitUntil(sweepStuckOutboundJobs(env, new Date(controller.scheduledTime)).catch((error) => console.error("Stuck outbound job sweep failed", error)));
		// MySQL only: recount message tallies after the purge, whose cascades fire no triggers there.
		if (controller.cron === "0 2 * * *") ctx.waitUntil(runAccountRetention(env, new Date(controller.scheduledTime)).finally(() => runMessageCounterRebuild(env)));
		// Drive trash is emptied once a day, with the 02:00 UTC cron; the 5-minute cron is for queue-like upkeep.
		if (controller.cron === "0 2 * * *") ctx.waitUntil(runDriveTrashRetention(env, new Date(controller.scheduledTime)));
		if (controller.cron === "0 2 * * *") ctx.waitUntil(runJmapChangeRetention(env, new Date(controller.scheduledTime)));
		if (controller.cron === "0 2 * * *") ctx.waitUntil(sweepOrphanedRawMail(env, new Date(controller.scheduledTime)).catch((error) => console.error("Raw mail sweep failed", error)));
		// Refresh SQLite planner statistics (D1); a no-op on PostgreSQL and MySQL, failures are only logged.
		if (controller.cron === "0 2 * * *") ctx.waitUntil(runDatabaseOptimize(env));
	},
} satisfies ExportedHandler<CloudflareEnv>;
