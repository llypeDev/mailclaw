import type { Messages } from "@/lib/i18n/types";

/**
 * The English strings of `global-error.tsx`. It replaces the root layout, so it has no language provider and
 * must render without fetching a catalog; copying these few keys keeps the whole English catalog out of the
 * page's JavaScript. tests/i18n.test.mjs checks that they match `public/locales/en.json`.
 */
export const GLOBAL_ERROR_MESSAGES = {
	"errorPage.title": "Something went wrong",
	"errorPage.description": "This page could not be displayed. Try again, or go back to the start page.",
	"errorPage.tryAgain": "Try again",
	"errorPage.goHome": "Go to start page",
	"errorPage.reference": "Reference: {digest}",
} satisfies Partial<Messages>;

/** Errors from Server Components carry a digest that matches the server log line. */
export function readErrorDigest(error: unknown): string | null {
	if (!error || typeof error !== "object" || !("digest" in error)) return null;
	const digest = (error as { digest?: unknown }).digest;
	return typeof digest === "string" && digest ? digest : null;
}
