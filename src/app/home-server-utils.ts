import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { APP_SETTINGS_ID, DEFAULT_APP_NAME } from "@/lib/branding/service";
import type { Branding } from "@/lib/branding/types";
import { getEnv } from "@/lib/cloudflare";
import { DEFAULT_BRANDING } from "@/components/branding-provider-utils";
import { brandingIconHref } from "./home-server-icon-utils";

type HomeBranding = Branding & { iconHref: string };

/**
 * Branding for the root layout, read once per render: the name and whether a custom icon exists (as
 * `getBranding` answers) plus the favicon URL. Without a custom icon that is the packaged static file, so
 * browsers never ask the Worker for it; with one it is `/api/branding/icon` versioned by the settings row.
 */
export const getHomeBranding = cache(async (): Promise<HomeBranding> => {
	try {
		const [settings] = await getDb(getEnv())
			.select({ appName: appSettings.appName, iconKey: appSettings.iconKey, updatedAt: appSettings.updatedAt })
			.from(appSettings)
			.where(eq(appSettings.id, APP_SETTINGS_ID))
			.limit(1);
		return {
			appName: settings?.appName || DEFAULT_APP_NAME,
			hasCustomIcon: !!settings?.iconKey,
			iconHref: brandingIconHref(settings ?? null),
		};
	} catch {
		return { ...DEFAULT_BRANDING, iconHref: brandingIconHref(null) };
	}
});
