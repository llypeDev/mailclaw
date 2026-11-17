/** The packaged icon, served as a static asset (no Worker request). `BrandingProvider` uses the same file. */
export const DEFAULT_ICON_HREF = "/icon-96.png";

/**
 * The favicon URL for the installation: the static icon unless a custom one is uploaded, in which case
 * `/api/branding/icon` carries the settings row's update time, so a new icon gets a new URL.
 */
export function brandingIconHref(settings: { iconKey: string | null; updatedAt: Date | number | null } | null): string {
	if (!settings?.iconKey) return DEFAULT_ICON_HREF;
	const updatedAt = settings.updatedAt instanceof Date ? settings.updatedAt.getTime() : settings.updatedAt;
	return typeof updatedAt === "number" && Number.isFinite(updatedAt)
		? `/api/branding/icon?v=${Math.floor(updatedAt / 1000)}`
		: "/api/branding/icon";
}
