import type { SpamClassification } from "./types";

/** Message ids per read. D1 allows 100 bound parameters per statement. */
export const FEEDBACK_ID_BATCH = 90;
/** Training statements sent per `batch` round trip; one message is never split across two. */
export const FEEDBACK_STATEMENT_BATCH = 500;

export type SpamFeedbackPlan = {
	/** Already classified this way: they are only moved. */
	moveOnly: string[];
	/** Trained (or retrained) and moved, in the order given. */
	train: Array<{ id: string; mailboxId: string }>;
};

/**
 * Which of `rows` a spam/not-spam verdict applies to, and how. Only inbound mail in a mailbox the
 * user can manage is eligible; everything else is skipped, as `applySpamFeedback` always did.
 */
export function planSpamFeedback(
	rows: Array<{ id: string; mailboxId: string | null; direction: string }>,
	previous: Map<string, { classification: SpamClassification }>,
	classification: SpamClassification,
	canManage: (mailboxId: string) => boolean,
): SpamFeedbackPlan {
	const plan: SpamFeedbackPlan = { moveOnly: [], train: [] };
	for (const row of rows) {
		if (!row.mailboxId || row.direction !== "inbound" || !canManage(row.mailboxId)) continue;
		if (previous.get(row.id)?.classification === classification) plan.moveOnly.push(row.id);
		else plan.train.push({ id: row.id, mailboxId: row.mailboxId });
	}
	return plan;
}
