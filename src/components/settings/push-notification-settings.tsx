"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
	disablePushNotifications,
	enablePushNotifications,
	getPushState,
} from "@/lib/push/client";
import { SETTING_DESCRIPTION_CLASS, SETTING_ERROR_CLASS, SETTING_ROWS_CLASS, SETTING_ROW_CLASS, SETTING_TITLE_CLASS } from "./settings-section-utils";

type State = {
	loading: boolean;
	supported: boolean;
	configured: boolean;
	permission: NotificationPermission | "unsupported";
	subscribed: boolean;
	error: string | null;
};

const initialState: State = {
	loading: true,
	supported: false,
	configured: false,
	permission: "unsupported",
	subscribed: false,
	error: null,
};

export function PushNotificationSettings() {
	const [state, setState] = useState<State>(initialState);

	useEffect(() => {
		let cancelled = false;
		getPushState()
			.then((next) => {
				if (!cancelled) setState({ ...next, loading: false, error: null });
			})
			.catch((error) => {
				if (!cancelled) {
					setState((current) => ({
						...current,
						loading: false,
						error: error instanceof Error ? error.message : "Failed to load notification settings",
					}));
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const disabled =
		state.loading ||
		!state.supported ||
		(!state.configured && !state.subscribed) ||
		(state.permission === "denied" && !state.subscribed);
	let description = "Get new mail alerts even when Mailclaw is closed.";
	if (!state.supported) description = "This browser does not support Web Push for Mailclaw.";
	else if (!state.configured) description = "Web Push has not been configured on this Mailclaw server.";
	else if (state.permission === "denied") description = "Notifications are blocked in your browser settings.";

	return (
		<div>
			<div className={SETTING_ROWS_CLASS}>
				<label className={SETTING_ROW_CLASS}>
					<span className="flex-1">
						<span className={SETTING_TITLE_CLASS}>Browser push notifications</span>
						<span className={SETTING_DESCRIPTION_CLASS}>{description}</span>
					</span>
					<Switch
						checked={state.subscribed}
						disabled={disabled}
						onCheckedChange={(enabled) => {
							setState((current) => ({ ...current, loading: true, error: null }));
							void (enabled ? enablePushNotifications() : disablePushNotifications())
								.then(() => getPushState())
								.then((next) => setState({ ...next, loading: false, error: null }))
								.catch((error) => {
									setState((current) => ({
										...current,
										loading: false,
										error: error instanceof Error ? error.message : "Failed to update notifications",
									}));
								});
						}}
						aria-label="Enable browser push notifications"
					/>
				</label>
			</div>
			{state.error && <p role="alert" className={SETTING_ERROR_CLASS}>{state.error}</p>}
		</div>
	);
}
