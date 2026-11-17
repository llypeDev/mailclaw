"use client";

import { useEffect, useState } from "react";
import { Kbd } from "@orangesys/ui";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { HeaderSearch } from "@/components/header-search";
import { useMailSearch } from "./mail-search-context";
import { useShortcuts } from "@/components/shortcuts";

const SEARCH_DEBOUNCE_MS = 250;

export function MailSearchInput({ mobileEnd }: { mobileEnd?: boolean }) {
	const { t } = useLanguage();
	const { query, setQuery } = useMailSearch();
	const [input, setInput] = useState(query);
	const { openCommandPalette, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	const showShortcutHints = shortcutsEnabled && !shortcutsPreferenceLoading;

	useEffect(() => {
		const delay = input.trim() ? SEARCH_DEBOUNCE_MS : 0;
		const timer = window.setTimeout(() => setQuery(input.trim() ? input : ""), delay);
		return () => window.clearTimeout(timer);
	}, [input, setQuery]);

	return (
		<HeaderSearch
			value={input}
			onChange={setInput}
			label={t("search.mail")}
			mobileEnd={mobileEnd}
			placeholder={showShortcutHints ? t("search.mailHint") : t("search.mail")}
			inputProps={{ "data-mail-search-input": "" }}
			trailing={input ? (
				<button
					type="button"
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => {
						setInput("");
						setQuery("");
					}}
					className="p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					aria-label={t("search.clear")}
				>
					<X className="h-4 w-4" />
				</button>
			) : showShortcutHints ? (
				<button
					type="button"
					onClick={openCommandPalette}
					className="hidden sm:flex items-center p-0.5 transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
					title={t("search.openPalette")}
				>
					<Kbd size="sm">⌘K</Kbd>
				</button>
			) : null}
		/>
	);
}
