"use client";

import { useEffect, useState } from "react";
import { Tag } from "@orangesys/ui";
import { CheckCircle2, CircleX, Database, RefreshCw } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	applyDatabaseMigrations,
	getApplicationUpdateStatus,
	getMigrationStatus,
	triggerApplicationUpdate,
} from "./admin-update-card-utils";
import type { MigrationStatusResponse, UpdateStatusResponse, UpdateWorkflowResponse } from "./admin-update-card-types";

export function AdminUpdateCard() {
	const { t } = useLanguage();
	const [status, setStatus] = useState<UpdateStatusResponse>();
	const [result, setResult] = useState<UpdateWorkflowResponse>();
	const [error, setError] = useState("");
	const [migrationError, setMigrationError] = useState("");
	const [migrationStatus, setMigrationStatus] = useState<MigrationStatusResponse>();
	const [isChecking, setIsChecking] = useState(true);
	const [isCheckingMigrations, setIsCheckingMigrations] = useState(true);
	const [isPending, setIsPending] = useState(false);
	const [isMigrating, setIsMigrating] = useState(false);

	useEffect(() => {
		let isActive = true;

		getApplicationUpdateStatus()
			.then((updateStatus) => {
				if (isActive) setStatus(updateStatus);
			})
			.catch((statusError) => {
				if (isActive) {
					setError(statusError instanceof Error ? statusError.message : t("update.checkFailed"));
				}
			})
			.finally(() => {
				if (isActive) setIsChecking(false);
			});

		getMigrationStatus()
			.then((databaseStatus) => {
				if (isActive) setMigrationStatus(databaseStatus);
			})
			.catch((statusError) => {
				if (isActive) {
					setMigrationError(statusError instanceof Error ? statusError.message : t("update.migrationCheckFailed"));
				}
			})
			.finally(() => {
				if (isActive) setIsCheckingMigrations(false);
			});

		return () => {
			isActive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- check once on mount; `t` only words the errors, and a language switch must not re-query the update and migration status
	}, []);

	async function handleUpdate() {
		setError("");
		setResult(undefined);
		setIsPending(true);

		try {
			setResult(await triggerApplicationUpdate());
		} catch (updateError) {
			setError(updateError instanceof Error ? updateError.message : t("update.startFailed"));
		} finally {
			setIsPending(false);
		}
	}

	async function handleMigrate() {
		setMigrationError("");
		setIsMigrating(true);
		try {
			setMigrationStatus(await applyDatabaseMigrations());
		} catch (migrationFailure) {
			setMigrationError(
				migrationFailure instanceof Error ? migrationFailure.message : t("update.migrateFailed"),
			);
		} finally {
			setIsMigrating(false);
		}
	}

	return (
		<Card className="border border-line bg-surface p-6">
			<CardHeader className="flex-row items-center gap-4 space-y-0 py-0">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center border border-line bg-canvas-subtle text-fg-muted">
					<RefreshCw className="h-5 w-5" />
				</div>
				<div>
					<CardTitle className="text-base">{t("update.title")}</CardTitle>
					<p className="mt-1 text-sm text-fg-muted">
						{t("update.description")}
					</p>
				</div>
			</CardHeader>
			<CardContent className="space-y-5 pt-5">
				{isChecking && <Skeleton className="h-20 w-full" />}

				{!isChecking && status?.configured === false && (
					<div className="space-y-3">
						<p className="text-sm text-fg-muted">
							{status.configuration?.length ? t("update.completeConfig") : t("update.selfHosted")}
						</p>
						{!!status.configuration?.length && (
							<ul className="divide-y divide-line overflow-hidden border border-line">
								{status.configuration.map((item) => (
									<li key={item.name} className="flex items-center gap-3 px-4 py-3 text-sm">
										{item.configured ? (
											<CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
										) : (
											<CircleX className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
										)}
										<code className="font-mono text-xs font-medium text-fg">{item.name}</code>
										<Tag size="sm" tone={item.configured ? "success" : "danger"} className="ms-auto shrink-0">
											{item.configured ? t("update.configured") : t("update.missing")}
										</Tag>
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				{!isChecking && status?.configured && (
					<div className="divide-y divide-line overflow-hidden border border-line">
						<div className="flex items-center gap-3 px-4 py-4">
							{status.available ? (
								<RefreshCw className={`h-4 w-4 shrink-0 text-accent-text ${isPending ? "animate-spin" : ""}`} aria-hidden="true" />
							) : (
								<CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
							)}
							<p className="min-w-0 text-sm text-fg">
								{status.available
									? t("update.available", { target: status.targetVersion, current: status.currentVersion })
									: t("update.upToDate", { current: status.currentVersion })}
							</p>
							{status.available && (
								<button
									type="button"
									onClick={handleUpdate}
									disabled={isPending}
									className="ms-auto shrink-0 font-display text-sm font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50"
								>
									{isPending ? t("update.starting") : t("update.updateButton")}
								</button>
							)}
						</div>
					</div>
				)}

				{(isCheckingMigrations || migrationStatus) && (
					<div className="divide-y divide-line overflow-hidden border border-line">
						{isCheckingMigrations && (
							<div className="flex items-center gap-3 px-4 py-4">
								<Skeleton className="h-4 w-4 rounded-full" />
								<Skeleton className="h-4 w-44" />
							</div>
						)}

						{!isCheckingMigrations && !!migrationStatus?.pending.length && !migrationStatus.unknown.length && (
							<div className="flex items-center gap-3 px-4 py-4">
								<Database className={`h-4 w-4 shrink-0 text-warning ${isMigrating ? "animate-pulse" : ""}`} aria-hidden="true" />
								<p className="text-sm text-fg">
									{t("update.pendingMigrations", { count: migrationStatus.pending.length })}
								</p>
								<button
									type="button"
									onClick={handleMigrate}
									disabled={isMigrating}
									className="ms-auto shrink-0 font-display text-sm font-semibold text-accent-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50"
								>
									{isMigrating ? t("update.updatingDatabase") : t("update.updateDatabase")}
								</button>
							</div>
						)}

						{!isCheckingMigrations && !!migrationStatus?.unknown.length && (
							<div className="flex items-center gap-3 px-4 py-4 text-sm text-danger-text">
								<CircleX className="h-4 w-4 shrink-0" />
								{t("update.deployMatching")}
							</div>
						)}

						{!isCheckingMigrations && migrationStatus?.ready && (
							<div className="flex items-center gap-3 px-4 py-4">
								<CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
								<p className="text-sm text-fg">{t("update.databaseUpToDate")}</p>
							</div>
						)}
					</div>
				)}

				{result?.ok && (
					<p className="text-sm text-success-text">
						{t("update.started", { repo: result.repository, ref: result.ref })}{" "}
						{result.runUrl && (
							<a className="font-medium underline" href={result.runUrl} target="_blank" rel="noreferrer">
								{t("update.viewWorkflow")}
								<span className="sr-only"> ({t("common.opensInNewTab")})</span>
							</a>
						)}
					</p>
				)}
				{error && <p role="alert" className="text-sm text-danger-text">{error}</p>}
				{migrationError && <p role="alert" className="text-sm text-danger-text">{migrationError}</p>}
			</CardContent>
		</Card>
	);
}
