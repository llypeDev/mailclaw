"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import {
	areBrowserNotificationsEnabled,
	setBrowserNotificationsEnabled,
} from "@/hooks/message-realtime-utils";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

export function BrowserNotificationSettings() {
	const { t } = useLanguage();
	const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
	const [enabled, setEnabled] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const refresh = () => {
			setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
			setEnabled(areBrowserNotificationsEnabled());
		};
		refresh();
		window.addEventListener("focus", refresh);
		window.addEventListener("storage", refresh);
		return () => {
			window.removeEventListener("focus", refresh);
			window.removeEventListener("storage", refresh);
		};
	}, []);

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="flex-1">
						<span className={SETTING_TITLE_CLASS}>{t("settings.notifications.title")}</span>
						<span className={SETTING_DESCRIPTION_CLASS}>
							{t("settings.notifications.description")}
						</span>
					</span>
					<Switch
						checked={permission === "granted" && enabled}
						disabled={permission === "unsupported" || permission === "denied"}
						onCheckedChange={(nextEnabled) => {
							setError(null);
							if (!nextEnabled) {
								try {
									setBrowserNotificationsEnabled(false);
									setEnabled(false);
								} catch {
									setError(t("settings.notifications.saveFailed"));
								}
								return;
							}
							void (async () => {
								try {
									const nextPermission = permission === "granted" ? permission : await Notification.requestPermission();
									setPermission(nextPermission);
									if (nextPermission !== "granted") return;
									setBrowserNotificationsEnabled(true);
									setEnabled(true);
								} catch {
									setError(t("settings.notifications.enableFailed"));
								}
							})();
						}}
						aria-label={t("settings.notifications.enable")}
					/>
				</label>
			</div>
			{permission === "denied" && (
				<p className="mt-2 text-sm text-fg-muted">{t("settings.notifications.blocked")}</p>
			)}
			{permission === "unsupported" && (
				<p className="mt-2 text-sm text-fg-muted">{t("settings.notifications.unavailable")}</p>
			)}
			{error && <p role="alert" className={SETTING_ERROR_CLASS}>{error}</p>}
		</div>
	);
}
