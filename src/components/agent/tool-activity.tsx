"use client";

import { useState } from "react";
import { ChevronLeft, Wrench } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import type { AgentDraftAction, AgentEmailReference, AgentMessage, AgentTurnProps } from "./types";
import { agentActionProposal, agentToolLabel, draftFromToolContent, parseAgentToolContent } from "./utils";
import { AgentEmailLink } from "./email-link";

function emailReferences(value: Record<string, unknown>): AgentEmailReference[] {
	if (Array.isArray(value.emails)) return value.emails.filter((item): item is AgentEmailReference => !!item && typeof item === "object" && typeof item.id === "string");
	if (typeof value.id === "string" && typeof value.subject === "string") return [value as AgentEmailReference];
	return [];
}

export function AgentToolActivity({ item, forceOpen }: { item: AgentMessage; forceOpen: boolean }) {
	const { t } = useLanguage();
	const [open, setOpen] = useState(forceOpen);
	const [prevForceOpen, setPrevForceOpen] = useState(forceOpen);
	if (forceOpen !== prevForceOpen) {
		setPrevForceOpen(forceOpen);
		setOpen(forceOpen);
	}
	const display = agentToolLabel(item.toolName, item.toolState, item.content, t);
	const result = parseAgentToolContent(item.content);
	const emails = result ? emailReferences(result) : [];
	return <details className="group/tool text-xs text-fg-muted" open={forceOpen || open} onToggle={(event) => { if (!forceOpen) setOpen(event.currentTarget.open); }}>
		<summary className="flex w-full max-w-full cursor-pointer list-none items-center gap-1.5 text-sm text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
			<Wrench size={13} className="shrink-0" aria-hidden="true" />
			<span className="truncate flex-1 min-w-0">{display.label}</span>
			<ChevronLeft size={13} className="shrink-0 transition-transform group-open/tool:-rotate-90" aria-hidden="true" />
		</summary>
		<div className="mt-1.5 space-y-2 border-s border-line-subtle ps-[17px] text-fg-muted">
			<p>{display.description}</p>
			{emails.length > 0 && <ul className="space-y-1.5">{emails.map((email) => <li key={email.id} className="break-words"><AgentEmailLink email={email} className="font-medium text-accent-text hover:underline" />{email.from && <span className="text-fg-subtle"> · {email.from}</span>}{email.snippet && <p className="line-clamp-2 text-fg-subtle">{email.snippet}</p>}</li>)}</ul>}
			{result && Object.entries(result).filter(([key, value]) => !["emails", "text", "attachments", "result", "id", "subject", "from", "snippet", "url", "reviewUrl", "action", "status"].includes(key) && value !== null && typeof value !== "object").map(([key, value]) => <p key={key} className="break-words"><span className="text-fg-subtle">{key.replace(/([A-Z])/g, " $1")}: </span>{String(value)}</p>)}
			{typeof result?.text === "string" && <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words">{result.text}</p>}
			{Array.isArray(result?.attachments) && result.attachments.length > 0 && <p>{t("agent.activity.attachments", { list: result.attachments.map((file: { filename?: string }) => file.filename || t("agent.activity.attachment")).join(", ") })}</p>}
			{!result && item.content && <p className="whitespace-pre-wrap break-words">{item.content}</p>}
		</div>
	</details>;
}

export function AgentDraftActions({ action, onOpenDraft, onApproveDraft, approvingId }: { action: AgentDraftAction } & Pick<AgentTurnProps, "onOpenDraft" | "onApproveDraft" | "approvingId">) {
	const { t } = useLanguage();
	return <div className="flex flex-wrap items-center justify-end gap-3 text-xs">
		<button type="button" onClick={() => onOpenDraft(action.draftId)} className="font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus">{t("agent.activity.editDraft")}</button>
		<Button type="button" size="sm" disabled={approvingId === action.draftId} onClick={() => onApproveDraft(action.draftId, action.revision)}>{action.scheduledAt ? t("agent.activity.schedule") : t("agent.activity.approveSend")}</Button>
	</div>;
}

export function AgentPendingActions({ item, onApproveAction, approvingId }: Pick<AgentTurnProps, "onApproveAction" | "approvingId"> & { item: AgentMessage }) {
	const { t } = useLanguage();
	const proposal = agentActionProposal(item.content);
	if (proposal?.status !== "pending_approval" || draftFromToolContent(item.content)) return null;
	return <div className="space-y-2 text-xs">
		{proposal.emails && <ul className="space-y-1">{proposal.emails.map((email) => <li key={email.id}><AgentEmailLink email={email} className="text-accent-text hover:underline" /></li>)}</ul>}
		<div className="flex flex-wrap items-center justify-end gap-3">
			<Button type="button" size="sm" disabled={!item.recordId || approvingId === item.id} onClick={() => onApproveAction(item)}>{approvingId === item.id ? t("agent.activity.approving") : proposal.action === "discard_draft" ? t("agent.activity.approveDiscard") : proposal.action === "mark_email_read" ? t("agent.activity.approveStatus") : t("agent.activity.approveMove", { destination: proposal.destination })}</Button>
		</div>
	</div>;
}
