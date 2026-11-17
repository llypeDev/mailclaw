"use client";

import { Alert, ProgressBar, Spinner, Tag, type TagTone } from "@orangesys/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImportJobSummary } from "@/lib/import/jobs-types";
import { fetchImportJobs, removeImportJob, resumeImportJob } from "@/app/(settings)/settings/import/utils";
import { getImportJobPercent, IMPORT_JOBS_POLL_MS, isImportJobActive } from "./import-jobs-utils";
import { SETTING_ROWS_CLASS } from "./settings-section-utils";

const STATUS_TONE: Record<ImportJobSummary["status"], TagTone> = {
	queued: "neutral",
	running: "info",
	completed: "success",
	failed: "danger",
	cancelled: "warning",
};

/** Imports run on the server; this lists them and follows the ones still working. `refreshKey` forces a reload. */
export function ImportJobs({ refreshKey }: { refreshKey: number }) {
	const { t } = useLanguage();
	const [jobs, setJobs] = useState<ImportJobSummary[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [resuming, setResuming] = useState<string | null>(null);
	const [password, setPassword] = useState("");
	const [resumeError, setResumeError] = useState<string | null>(null);
	const previous = useRef<Map<string, ImportJobSummary["status"]>>(new Map());

	const load = useCallback(() => fetchImportJobs()
		.then((next) => {
			const finishedNow = next.some((job) => {
				const before = previous.current.get(job.id);
				return !!before && (before === "queued" || before === "running") && !isImportJobActive(job);
			});
			previous.current = new Map(next.map((job) => [job.id, job.status]));
			setJobs(next);
			if (finishedNow) window.dispatchEvent(new Event("mailclaw:messages-changed"));
		})
		.catch(() => {
			// Keep the last list; the next poll retries.
		})
		.finally(() => {
			setLoaded(true);
		}), []);

	const hasActive = jobs.some(isImportJobActive);

	useEffect(() => {
		void load();
	}, [load, refreshKey]);

	useEffect(() => {
		if (!hasActive) return;
		const timer = setInterval(() => void load(), IMPORT_JOBS_POLL_MS);
		return () => clearInterval(timer);
	}, [hasActive, load]);

	async function onRemove(job: ImportJobSummary) {
		try {
			await removeImportJob(job.id);
		} finally {
			await load();
		}
	}

	async function onResume(job: ImportJobSummary) {
		if (job.kind === "imap" && resuming !== job.id) {
			setResuming(job.id);
			setPassword("");
			setResumeError(null);
			return;
		}
		try {
			await resumeImportJob(job.id, job.kind === "imap" ? password : undefined);
			setResuming(null);
			setPassword("");
			setResumeError(null);
		} catch (error) {
			setResumeError(error instanceof Error ? error.message : t("importJobs.resumeFailed"));
		} finally {
			await load();
		}
	}

	if (loaded && jobs.length === 0) return null;

	return (
		<section className="space-y-4 border-t border-line pt-8" aria-live="polite">
			{hasActive && (
				<p className="flex items-center gap-2 text-sm text-fg-muted">
					<Spinner size="sm" decorative />
					{t("importJobs.running")}
				</p>
			)}
			<ul className={SETTING_ROWS_CLASS}>
				{jobs.map((job) => {
					const percent = getImportJobPercent(job);
					const active = isImportJobActive(job);
					return (
						<li key={job.id} className="space-y-3 px-4 py-4 sm:px-5">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-fg">{job.label}</p>
									<p className="text-xs text-fg-muted">
										{job.kind === "imap" ? t("importPage.imap") : t("importPage.backupFile")} ·{" "}
										{new Date(job.createdAt).toLocaleString()}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<Tag size="sm" variant="solid" tone={STATUS_TONE[job.status]}>
										{t(`importJobs.status.${job.status}`)}
									</Tag>
									{job.status === "failed" && (
										<Button type="button" size="sm" onClick={() => void onResume(job)}>
											{t("importJobs.resume")}
										</Button>
									)}
									<Button type="button" variant="outline" size="sm" onClick={() => void onRemove(job)}>
										{active ? t("importJobs.cancel") : t("importJobs.dismiss")}
									</Button>
								</div>
							</div>
							{active && (
								<ProgressBar
									size="sm"
									label={job.currentSource
										? t("importPage.importingSource", { source: job.currentSource })
										: job.status === "queued"
											? t("importJobs.waiting")
											: t("importPage.importingMessages")}
									value={percent}
								/>
							)}
							<p className="font-mono text-xs text-fg-muted">
								{active && job.total <= 0 ? (
									<span className="inline-flex items-center gap-1.5 font-sans">
										<Spinner size="sm" tone="current" decorative />
										{t("importJobs.counting")}
									</span>
								) : (
									t("importJobs.counts", {
										processed: job.processed,
										total: job.total,
										imported: job.imported,
										skipped: job.skipped,
									})
								)}
							</p>
							{resuming === job.id && job.status === "failed" && (
								<form
									className="flex items-center gap-2"
									onSubmit={(event) => {
										event.preventDefault();
										void onResume(job);
									}}
								>
									<Input
										type="password"
										autoComplete="off"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
										placeholder={t("importJobs.resumePassword")}
										aria-label={t("importJobs.resumePassword")}
									/>
									<Button type="submit" size="sm" disabled={!password}>
										{t("importJobs.resume")}
									</Button>
								</form>
							)}
							{resuming === job.id && resumeError && <p role="alert" className="text-xs text-danger-text">{resumeError}</p>}
							{job.error && (
								<Alert tone="danger">{job.error}</Alert>
							)}
							{job.errorCount > 0 && (
								<details className="text-xs text-fg-muted">
									<summary className="cursor-pointer">{t("importJobs.errors", { count: job.errorCount })}</summary>
									<ul className="mt-2 list-disc space-y-1 ps-5">
										{job.errors.slice(0, 5).map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</details>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
