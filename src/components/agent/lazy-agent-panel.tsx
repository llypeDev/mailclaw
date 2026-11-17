"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { AgentPanel as AgentPanelComponent } from "@/components/agent/agent-panel";
import type { AgentPanelProps } from "./types";

type AgentPanelType = typeof AgentPanelComponent;

let loaded: AgentPanelType | null = null;
let loading: Promise<AgentPanelType> | null = null;

/** Loads the assistant panel (and react-markdown with it) in its own chunk; a failed load is retried next time. */
export function preloadAgentPanel(): Promise<AgentPanelType> {
	loading ??= import("@/components/agent/agent-panel")
		.then((module) => (loaded = module.AgentPanel))
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

/**
 * `AgentPanel` kept out of the dashboard's first bundle: it loads the first time the panel opens (the
 * assistant button also preloads it on hover or focus) and then stays mounted, as before, so a closed
 * panel keeps its conversation.
 */
export function LazyAgentPanel(props: AgentPanelProps) {
	const { t } = useLanguage();
	const [Panel, setPanel] = useState<AgentPanelType | null>(() => loaded);
	const { open } = props;

	useEffect(() => {
		if (Panel || !open) return;
		let cancelled = false;
		preloadAgentPanel()
			.then((component) => {
				if (!cancelled) setPanel(() => component);
			})
			// Retried when the panel is opened again.
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [Panel, open]);

	if (Panel) return <Panel {...props} />;
	if (!open) return null;
	return (
		<div className="flex h-full items-center justify-center" role="status">
			<Loader2 className="h-5 w-5 animate-spin text-neutral-500" aria-hidden="true" />
			<span className="sr-only">{t("nav.loading")}</span>
		</div>
	);
}
