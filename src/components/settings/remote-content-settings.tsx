"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import {
	loadRemoteContentPolicy,
	updateRemoteContentMode,
	type RemoteContentMode,
} from "@/components/messages/use-remote-content-utils";
import { SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS } from "./settings-section-utils";

const OPTIONS = [
	{ mode: "ask", title: "settings.remoteContent.ask" },
	{ mode: "new_sender", title: "settings.remoteContent.newSender" },
	{ mode: "allow", title: "settings.remoteContent.allow" },
] as const;

export function RemoteContentSettings() {
	const { t } = useLanguage();
	const [mode, setMode] = useState<RemoteContentMode>("allow");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadRemoteContentPolicy()
			.then((policy) => { if (!cancelled) setMode(policy.mode); })
			.catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("settings.remoteContent.failed")); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const choose = (next: RemoteContentMode) => {
		const previous = mode;
		setMode(next);
		setSaving(true);
		setError(null);
		updateRemoteContentMode(next)
			.then(setMode)
			.catch((updateError) => {
				setMode(previous);
				setError(updateError instanceof Error ? updateError.message : t("settings.remoteContent.failed"));
			})
			.finally(() => setSaving(false));
	};

	return (
		<div>
			<div role="radiogroup" aria-label={t("settingsPage.inbox.remoteContent")} className={SETTING_ROWS_CLASS}>
				{OPTIONS.map((option) => (
					<label key={option.mode} className={`${SETTING_ROW_CLASS} cursor-pointer gap-3 hover:bg-surface-hover has-[:checked]:bg-accent-subtle`}>
						<input
							type="radio"
							name="remote-content-mode"
							className="h-4 w-4 shrink-0 accent-[var(--or-color-accent)]"
							checked={mode === option.mode}
							disabled={loading || saving}
							onChange={() => choose(option.mode)}
						/>
						<span className="flex-1 text-sm font-medium text-fg">{t(option.title)}</span>
					</label>
				))}
			</div>
			{error && <p role="alert" className={SETTING_ERROR_CLASS}>{error}</p>}
		</div>
	);
}
