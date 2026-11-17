import type { MessageKey, Messages } from "@orangesys/ui";
import type { TranslationKey } from "@/lib/i18n/types";

/**
 * Orange's components show built-in texts (close buttons, pagination, screen-reader announcements…) from
 * OrangeProvider's `messages`. Mailclaw keeps them in its own catalogs as `orange.<Orange key>`, so every
 * interface language translates them; tests/orange-messages.test.mjs fails when an Orange release adds a
 * key that en.json lacks.
 */
export const ORANGE_KEY_PREFIX = "orange.";

export type OrangeCatalogKey = `orange.${MessageKey}`;

export function orangeCatalogKey(key: MessageKey): OrangeCatalogKey {
	return `${ORANGE_KEY_PREFIX}${key}` as OrangeCatalogKey;
}

/** The keys of `reference` (one of Orange's complete dictionaries, e.g. `enUS`) that `catalog` has no `orange.*` entry for. */
export function missingOrangeKeys(reference: Messages, catalog: Readonly<Record<string, unknown>>): MessageKey[] {
	return (Object.keys(reference) as MessageKey[]).filter((key) => typeof catalog[orangeCatalogKey(key)] !== "string");
}

/**
 * Orange's messages in the active Mailclaw language. `translate` returns the raw catalog text for a key (no
 * vars, so Orange's `{placeholders}` survive for Orange to fill) or the key itself when the catalog lacks it,
 * as Mailclaw's translator does; such keys keep `reference`'s text instead of showing the key.
 */
export function orangeMessages(reference: Messages, translate: (key: TranslationKey) => string): Messages {
	const messages = { ...reference };
	for (const key of Object.keys(reference) as MessageKey[]) {
		const catalogKey = orangeCatalogKey(key) as TranslationKey;
		const text = translate(catalogKey);
		if (text && text !== catalogKey) messages[key] = text;
	}
	return messages;
}
