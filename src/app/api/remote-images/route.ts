import { requireSessionUser } from "@/lib/api/auth";
import { getEnv } from "@/lib/cloudflare";
import { fetchRemoteImage, RemoteImageError } from "@/lib/remote-images/fetch";
import { allowRemoteImageRequest } from "@/lib/remote-images/rate-limit";

const IMAGE_HEADERS = {
	// The URL names the image, so the viewer's own browser may keep it for a
	// day; `private` keeps it out of every shared cache. Errors stay no-store.
	"Cache-Control": "private, max-age=86400",
	"Content-Security-Policy": "default-src 'none'; sandbox",
	"Cross-Origin-Resource-Policy": "same-origin",
	"X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
	const env = getEnv();
	const auth = await requireSessionUser(env, request);
	if (auth.error) return auth.error;
	if (!allowRemoteImageRequest(auth.user.id)) {
		return Response.json({ error: "Too many remote image requests" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
	}

	const requestUrl = new URL(request.url);
	const remoteUrl = requestUrl.searchParams.get("url") ?? "";
	try {
		const image = await fetchRemoteImage(remoteUrl, { blockedOrigins: [requestUrl.origin] });
		// Streamed: the signature is already checked, and a body that later passes the size cap or the
		// deadline errors mid-response. The browser then sees a truncated image; with no validator to
		// resume it from, the incomplete entry is not kept in its cache.
		return new Response(image.body, {
			headers: { ...IMAGE_HEADERS, "Content-Type": image.contentType },
		});
	} catch (error) {
		if (error instanceof RemoteImageError) {
			return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
		}
		return Response.json({ error: "Could not fetch remote image" }, { status: 502, headers: { "Cache-Control": "no-store" } });
	}
}
