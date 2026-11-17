"use client";

import { useState } from "react";
import { CornerDownRight, Pencil, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { QueuedAgentMessagesProps } from "./types";

export function QueuedAgentMessages({ messages, running, onRemove, onEdit, onSteer }: QueuedAgentMessagesProps) {
	const { t } = useLanguage();
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editText, setEditText] = useState("");
	if (!messages.length) return null;
	return <div className="mx-auto w-full max-w-3xl px-3" aria-label={t("agent.queue.label")}><div className="max-h-48 overflow-y-auto border border-b-0 border-line bg-canvas-subtle px-2 py-1">
		{messages.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-2 px-2 py-2 text-sm text-fg-muted hover:bg-surface-hover">
			<CornerDownRight size={15} className="shrink-0 text-fg-subtle rtl:-scale-x-100" aria-hidden="true" />
			{editingId === item.id ? <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); if (!editText.trim()) return; onEdit(item.id, editText); setEditingId(null); }}><textarea autoFocus rows={2} className="min-w-0 flex-1 resize-y border border-line-control bg-surface px-2 py-1 text-fg outline-none focus:border-focus focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus" value={editText} onChange={(event) => setEditText(event.target.value)} aria-label={t("agent.queue.edit")} /><button type="submit" className="shrink-0 font-medium text-accent-text hover:underline disabled:text-fg-disabled disabled:no-underline" disabled={!editText.trim()}>{t("settings.autoReply.save")}</button><button type="button" className="shrink-0 text-fg-subtle hover:text-fg" onClick={() => setEditingId(null)}>{t("common.cancel")}</button></form> : <><span className="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span><button type="button" className="shrink-0 px-2 py-1 text-fg-subtle hover:bg-accent-subtle hover:text-accent-text focus-visible:outline-2 focus-visible:outline-focus" onClick={() => onSteer(item.id)} title={running ? t("agent.queue.steerTitle") : t("agent.queue.sendNowTitle")}>{running ? t("agent.queue.steer") : t("agent.queue.sendNow")}</button><button type="button" className="shrink-0 p-1.5 text-fg-subtle hover:bg-accent-subtle hover:text-accent-text focus-visible:outline-2 focus-visible:outline-focus" aria-label={t("agent.queue.edit")} title={t("agent.queue.edit")} onClick={() => { setEditingId(item.id); setEditText(item.text); }}><Pencil size={15} /></button><button type="button" className="shrink-0 p-1.5 text-fg-subtle hover:bg-danger-subtle hover:text-danger-text focus-visible:outline-2 focus-visible:outline-focus" aria-label={t("agent.queue.remove")} title={t("agent.queue.remove")} onClick={() => onRemove(item.id)}><Trash2 size={15} /></button></>}
		</div>)}
	</div></div>;
}
