import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { contacts, domains, spamReputation } from "@/db/schema";
import { charIndex } from "@/db/sql";
import { getEmailAddress } from "@/lib/email/address";
import { analyzeAuthentication } from "./analyzers/authentication";
import { analyzeImpersonation } from "./analyzers/impersonation";
import { extractSenderIp } from "./domain-utils";
import { getReputationKeys } from "./analyzers/reputation";
import { analyzeStructure } from "./analyzers/structure";
import { analyzeUrls } from "./analyzers/urls";
import { classifyTokens, selectFeedbackTotals } from "./classifier";
import { buildFingerprint, getDomain, prepareSpamContent, tokenizeMessage } from "./tokenizer";
import type { SpamAnalysisInput, SpamAnalysisResult, SpamSignal } from "./types";
import { SPAM_THRESHOLDS, SPAM_WEIGHTS } from "./weights";
import { LocalSpamIntelligenceProvider } from "./providers/local";

const MAX_KNOWN_DOMAINS = 2000;

/**
 * Every read the analysis needs, as one batch: D1 counts a batch as a single query against the
 * per-invocation limit (50 on Workers Free), and none of these depends on another.
 * - domains a lookalike sender would imitate: ones the user wrote to or saved, and the instance's own;
 * - the sender's contact row (an empty sender matches nothing, since stored addresses never are);
 * - the mailbox's reputation for each identity, in one query: (mailbox_id, type, key) is unique;
 * - the classifier's spam and ham totals.
 */
function loadSpamContext(db: AppDatabase, input: SpamAnalysisInput, sender: string, identities: ReturnType<typeof getReputationKeys>) {
	const contactDomain = sql<string>`lower(substr(${contacts.email}, ${charIndex(contacts.email, "@")} + 1))`;
	return db.batch([
		db.selectDistinct({ domain: contactDomain }).from(contacts)
			.where(and(eq(contacts.userId, input.userId), inArray(contacts.source, ["outbound", "manual"])))
			.limit(MAX_KNOWN_DOMAINS),
		db.select({ domain: domains.hostname }).from(domains),
		db.select().from(contacts).where(and(eq(contacts.userId, input.userId), eq(contacts.email, sender))).limit(1),
		db.select().from(spamReputation).where(and(
			eq(spamReputation.mailboxId, input.mailboxId),
			or(...identities.map((identity) => and(eq(spamReputation.type, identity.type), eq(spamReputation.key, identity.key)))),
		)),
		selectFeedbackTotals(db, input.mailboxId),
	]);
}

export async function analyzeSpam(db: AppDatabase, input: SpamAnalysisInput): Promise<SpamAnalysisResult> {
	const prepared = prepareSpamContent(input.message);
	const fingerprint = buildFingerprint(input.message, prepared);
	const sender = getEmailAddress(input.message.fromAddr ?? input.envelopeFrom).toLowerCase();
	const identities = getReputationKeys(input.message, fingerprint);
	const [contactDomainRows, ownDomainRows, [contact], reputationRows, feedbackTotals] = await loadSpamContext(db, input, sender, identities);
	const knownDomains = [...contactDomainRows, ...ownDomainRows].map((row) => row.domain).filter(Boolean);
	const signals: SpamSignal[] = [
		...analyzeAuthentication(input.headers, input.verdicts),
		...analyzeUrls(input.message, prepared),
		...analyzeStructure(input.message, input.headers, prepared),
		...analyzeImpersonation(input.message.fromAddr ?? input.envelopeFrom, knownDomains, input.brands),
	];
	const intelligenceProvider = input.intelligenceProvider ?? new LocalSpamIntelligenceProvider();
	signals.push(...await intelligenceProvider.check({
		senderDomain: getDomain(sender),
		urlDomains: prepared.urlDomains,
		fingerprint,
		senderIp: input.senderIp ?? extractSenderIp(input.headers),
	}).catch(() => []));

	// Relationship trust must not offset a failed authentication: a spoofed known contact is the attack.
	const failed = new Set(signals.map((signal) => signal.id));
	const authPolicyReason = failed.has("dmarc_failed")
		? "DMARC authentication failed"
		: failed.has("spf_failed") && failed.has("dkim_failed")
			? "Both SPF and DKIM authentication failed"
			: failed.has("provider_spam_verdict")
				? "The receiving mail provider classified this message as spam"
				: null;

	if (contact?.blocked) {
		return { score: 100, verdict: "spam", signals: [{ id: "blocked_sender", score: 100, reason: "Sender is blocked" }], fingerprint };
	}
	if (!authPolicyReason && contact?.source === "manual") signals.push({ id: "manual_contact", score: SPAM_WEIGHTS.relationships.manuallySavedContact, reason: "Sender is in your manually saved contacts" });
	if (!authPolicyReason && contact?.source === "outbound") signals.push({ id: "previously_sent", score: SPAM_WEIGHTS.relationships.previouslySentTo, reason: "You have previously sent email to this address" });

	const reputationRecords = identities.map((identity) => ({
		identity,
		record: reputationRows.find((row) => row.type === identity.type && row.key === identity.key),
	}));
	const reputationSignals: SpamSignal[] = [];
	for (const { identity, record } of reputationRecords) {
		if (!record || record.spamCount + record.hamCount < 3) continue;
		const spamRatio = (record.spamCount + 1) / (record.spamCount + record.hamCount + 2);
		if (spamRatio >= 0.8) reputationSignals.push({ id: `poor_${identity.type}_reputation`, score: SPAM_WEIGHTS.reputation.establishedSpam, reason: `${identity.type === "fingerprint" ? "Similar messages have" : "This sender has"} repeatedly been marked as spam` });
		if (spamRatio <= 0.2) reputationSignals.push({ id: `good_${identity.type}_reputation`, score: SPAM_WEIGHTS.reputation.establishedHam, reason: `${identity.type === "fingerprint" ? "Similar messages have" : "This sender has"} repeatedly been marked as legitimate` });
	}
	const strongestReputation = reputationSignals.sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
	if (strongestReputation) signals.push(strongestReputation);

	const bayesian = await classifyTokens(db, input.mailboxId, tokenizeMessage(input.message, prepared), feedbackTotals);
	if (bayesian.contribution !== 0) signals.push({
		id: bayesian.contribution > 0 ? "bayesian_spam" : "bayesian_ham",
		score: bayesian.contribution,
		reason: bayesian.contribution > 0 ? "Content resembles messages previously marked as spam" : "Content resembles messages previously marked as legitimate",
		metadata: { probability: Number(bayesian.probability.toFixed(3)), trainedMessages: bayesian.trainedMessages },
	});

	const scoreBeforePolicy = signals.reduce((total, signal) => total + signal.score, 0);
	if (authPolicyReason && scoreBeforePolicy < SPAM_THRESHOLDS.spam) signals.push({ id: "auth_policy", score: SPAM_THRESHOLDS.spam - scoreBeforePolicy, reason: `${authPolicyReason}; filed as spam by authentication policy` });

	const rawScore = signals.reduce((total, signal) => total + signal.score, 0);
	const score = Math.max(0, Math.min(100, rawScore));
	if (rawScore !== score) signals.push({
		id: "score_boundary",
		score: score - rawScore,
		reason: rawScore > 100 ? "Score is capped at 100" : "Score cannot be lower than 0",
	});
	const verdict = score >= SPAM_THRESHOLDS.spam ? "spam" : score >= SPAM_THRESHOLDS.suspicious ? "suspicious" : "inbox";
	return { score, verdict, signals: signals.filter((signal) => Math.abs(signal.score) >= 2 || signal.id === "score_boundary"), contentProbability: bayesian.probability, fingerprint };
}
