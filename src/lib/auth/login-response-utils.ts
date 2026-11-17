/**
 * Whether a sign-in response may carry the session token in its JSON body.
 *
 * Browsers get the session only as the httpOnly cookie, so script injected
 * into the page cannot read a 30-day credential out of a response. A browser
 * fetch always sends `Sec-Fetch-Site` (or, in older engines, `Origin` on a
 * POST), and page script cannot remove either. A request with neither comes
 * from a non-browser client, such as `scripts/import-gmail-takeout.mjs`, which
 * has no cookie jar and needs the token as a Bearer credential.
 * (`Sec-Fetch-Mode` is no signal: Node's fetch sends it too.)
 */
export function shouldReturnSessionToken(request: Request): boolean {
	return !request.headers.has("Sec-Fetch-Site") && !request.headers.has("Origin");
}
