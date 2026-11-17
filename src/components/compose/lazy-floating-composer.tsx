"use client";

import { useEffect, useState } from "react";
import { MailPlus } from "@/components/icons";
import { useCompose } from "@/components/compose/compose-context";
import { useLanguage } from "@/components/language-provider";
import { useSidebar } from "@/components/sidebar-state";
import type { FloatingComposer as FloatingComposerComponent } from "@/components/compose/floating-composer";
import { COMPOSE_FAB_CLASS } from "./compose-fab-utils";

type FloatingComposerType = typeof FloatingComposerComponent;

/** How long after the dashboard mounts the composer code may wait for an idle moment before it loads anyway. */
const IDLE_PRELOAD_TIMEOUT_MS = 4000;

let loaded: FloatingComposerType | null = null;
let loading: Promise<FloatingComposerType> | null = null;

/**
 * Loads the composer (compose form, rich-text editor and the HTML sanitiser: DOMPurify, css-tree, parse5)
 * in its own chunk. A failed load is forgotten so the next attempt retries.
 */
export function preloadFloatingComposer(): Promise<FloatingComposerType> {
	loading ??= import("@/components/compose/floating-composer")
		.then((module) => (loaded = module.FloatingComposer))
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

function whenIdle(run: () => void): () => void {
	// Safari only recently gained requestIdleCallback.
	if (typeof window.requestIdleCallback === "function") {
		const id = window.requestIdleCallback(run, { timeout: IDLE_PRELOAD_TIMEOUT_MS });
		return () => window.cancelIdleCallback(id);
	}
	const id = globalThis.setTimeout(run, 1500);
	return () => globalThis.clearTimeout(id);
}

/**
 * `FloatingComposer` kept out of the dashboard's first bundle. Its code loads when the browser is idle
 * after the page is up, or at once when the composer opens or a send notice appears first; until then
 * this draws the phone Compose button itself (the same button `FloatingComposer` draws).
 */
export function LazyFloatingComposer({ showButton = false }: { showButton?: boolean }) {
	const { open, notice, openComposer } = useCompose();
	const { mobileOpen } = useSidebar();
	const { t } = useLanguage();
	const [Composer, setComposer] = useState<FloatingComposerType | null>(() => loaded);
	const needed = open || notice !== null;

	useEffect(() => {
		if (Composer) return;
		let cancelled = false;
		const load = () => {
			preloadFloatingComposer()
				.then((component) => {
					if (!cancelled) setComposer(() => component);
				})
				// Retried when the composer is next opened or the next notice appears.
				.catch(() => undefined);
		};
		if (needed) {
			load();
			return () => {
				cancelled = true;
			};
		}
		const cancelIdle = whenIdle(load);
		return () => {
			cancelled = true;
			cancelIdle();
		};
	}, [Composer, needed, open, notice]);

	if (Composer) return <Composer showButton={showButton} />;
	if (!showButton || open || mobileOpen) return null;
	return (
		<button
			type="button"
			onClick={() => openComposer()}
			aria-label={t("navigation.compose")}
			className={COMPOSE_FAB_CLASS}
		>
			<MailPlus size={19} />
			{t("navigation.compose")}
		</button>
	);
}
