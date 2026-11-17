"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { buildMcpAgentPrompt } from "./mcp-agent-instructions-utils";
import type { McpAgentInstructionsProps } from "./mcp-agent-instructions-types";

const subscribeNothing = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

export function McpAgentInstructions(props: McpAgentInstructionsProps) {
	const { t } = useLanguage();
	const origin = useSyncExternalStore(subscribeNothing, clientOrigin, serverOrigin);
	const [copied, setCopied] = useState(false);
	const prompt = buildMcpAgentPrompt(origin, props);

	return <div className="space-y-2 border border-line bg-surface p-3">
		<div className="flex items-center justify-between gap-3">
			<strong className="font-display text-sm font-semibold text-fg">{t("mcp.instructions")}</strong>
			<Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(prompt).then(() => setCopied(true))}><Copy className="h-4 w-4" />{copied ? t("common.copied") : t("mcp.copyPrompt")}</Button>
		</div>
		<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border border-line bg-canvas-subtle p-3 font-mono text-xs text-fg-muted">{prompt}</pre>
	</div>;
}
