import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { APP_SETTINGS_ID } from "@/lib/branding/service";
import { getEnvAsync } from "@/lib/cloudflare";
import { etagMatches } from "@/lib/http/object-cache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The layout links `?v=<app_settings.updated_at>`, which changes whenever the
 * branding does, so a versioned URL never needs revalidating. Unversioned
 * links keep the hour-long policy.
 */
function iconCacheControl(request: Request): string {
	return new URL(request.url).searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
}

async function getDefaultIcon(env: CloudflareEnv, cacheControl: string): Promise<Response> {
	const asset = await env.ASSETS.fetch("https://mailclaw.local/icon-96.png");
	const headers = new Headers(asset.headers);
	// The asset binding defaults to revalidation; this endpoint uses a versioned URL on changes.
	if (asset.ok) headers.set("Cache-Control", cacheControl);
	return new Response(asset.body, {
		status: asset.status,
		statusText: asset.statusText,
		headers,
	});
}

export async function GET(request: Request) {
	const env = await getEnvAsync();
	const cacheControl = iconCacheControl(request);
	try {
		const [settings] = await getDb(env)
			.select({ iconKey: appSettings.iconKey })
			.from(appSettings)
			.where(eq(appSettings.id, APP_SETTINGS_ID))
			.limit(1);
		if (settings?.iconKey) {
			const ifNoneMatch = request.headers.get("If-None-Match");
			// A revalidation only needs the ETag: read the metadata, not the image.
			const head = ifNoneMatch ? await env.BUCKET.head(settings.iconKey) : null;
			if (head && etagMatches(ifNoneMatch, head.httpEtag)) {
				return new Response(null, { status: 304, headers: customIconHeaders(head, cacheControl) });
			}
			const object = await env.BUCKET.get(settings.iconKey);
			if (object) return new Response(object.body, { headers: customIconHeaders(object, cacheControl) });
		}
	} catch {
		// Use the packaged icon until the branding migration is available.
	}
	return getDefaultIcon(env, cacheControl);
}

function customIconHeaders(object: Pick<R2Object, "httpEtag" | "httpMetadata">, cacheControl: string): Headers {
	const headers = new Headers({
		"Content-Type": object.httpMetadata?.contentType ?? "image/png",
		"Cache-Control": cacheControl,
		"X-Content-Type-Options": "nosniff",
	});
	if (object.httpEtag) headers.set("ETag", object.httpEtag);
	return headers;
}
