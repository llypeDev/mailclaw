"use client";

import type { FormEvent } from "react";
import { Alert } from "@orangesys/ui";
import { useState } from "react";
import { Upload } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ImportMessagesProps, ImportMessagesResult } from "./import-messages-types";
import { importMessageFiles } from "./import-messages-utils";
import { SETTING_FILE_INPUT_CLASS, SETTING_HINT_CLASS } from "./settings-section-utils";

export function ImportMessages({ destination, sourceLabel }: ImportMessagesProps) {
	const { t } = useLanguage();
	const { selectedMailbox } = useSelectedMailbox();
	const [files, setFiles] = useState<File[]>([]);
	const [loading, setLoading] = useState(false);
	const [result, setResult] = useState<ImportMessagesResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox?.id || files.length === 0) return;

		setLoading(true);
		setError(null);
		setResult(null);
		try {
			const nextResult = await importMessageFiles(selectedMailbox.id, files, destination);
			setResult(nextResult);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("import.failed"));
		} finally {
			setLoading(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Upload className="h-4 w-4" />
					{t("import.title")}
				</CardTitle>
				<CardDescription>
					{t("import.description", { source: sourceLabel })}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={onSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="mail-import">{t("import.filesLabel")}</Label>
						<Input
							id="mail-import"
							type="file"
							accept=".eml,.mbox,.mbx,message/rfc822,application/mbox"
							multiple
							onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
							className={SETTING_FILE_INPUT_CLASS}
						/>
						<p className={SETTING_HINT_CLASS}>
							{t("import.limits")}
						</p>
					</div>

					<Button type="submit" disabled={!selectedMailbox || files.length === 0 || loading}>
						{loading ? t("import.importing") : t("import.submit")}
					</Button>

					{result?.job && (
						<Alert tone="success" live>
							{t("importJobs.started")}
						</Alert>
					)}

					{error && (
						<Alert tone="danger" live>
							{error}
						</Alert>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
