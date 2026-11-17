import type { AgentJob } from "./types";

/** How often an open, visible panel re-reads its jobs while one is unfinished. */
export const AGENT_JOB_POLL_INTERVAL_MS = 30_000;

/**
 * A finished auto-draft arrives over the realtime socket (`agent_draft`), so
 * the panel only polls while a job may still fail or be skipped, which send no
 * notification. The panel also stops polling while its tab is hidden.
 */
export function hasUnfinishedAgentJob(jobs: Pick<AgentJob, "status">[]): boolean {
	return jobs.some((job) => job.status === "pending" || job.status === "running");
}
