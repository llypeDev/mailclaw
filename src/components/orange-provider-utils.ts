import type { Locale } from "@/lib/i18n/types";

/**
 * The Orange locale for a Mailclaw locale. Orange ships Portuguese and English built in and Spanish as
 * a dictionary; everything else uses English until Mailclaw supplies its own translations.
 */
export function orangeLocale(locale: Locale): "pt-BR" | "en-US" | "es-ES" {
	if (locale.startsWith("pt")) return "pt-BR";
	if (locale.startsWith("es")) return "es-ES";
	return "en-US";
}
