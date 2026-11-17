import { useEffect, useRef, useState } from "react";
import type { Message, MessageFilterOptions, MessageFolder, MessageListResponse } from "./types";
import { fetchMessageTotal, peekMessageTotal, rememberMessageTotal } from "./message-total-cache";
import { getMessageTotalKey, hasNextMessagePage } from "./message-total-utils";
import {
	clearMessageCountsCache,
	clearMessageListCache,
	fetchMessageList,
	getMessageQueryParams,
	peekMessageList,
} from "./utils";

const REFRESH_DEBOUNCE_MS = 150;

function initialTotal(page: MessageListResponse | undefined, params: URLSearchParams): number | null {
	if (!page) return null;
	return typeof page.total === "number" ? page.total : peekMessageTotal(params) ?? null;
}

export function useMessages(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	enabled = true,
	folderId?: string | null,
) {
	// A folder switch remounts this hook, so paint the cached page immediately.
	const [initialPage] = useState(() => (
		enabled ? peekMessageList(getMessageQueryParams(folder, mailboxId, filters, folderId)) : undefined
	));
	const [messages, setMessages] = useState<Message[]>(initialPage?.messages ?? []);
	const [isLoading, setIsLoading] = useState(enabled && !initialPage);
	// Null while the view's total is unknown: a full page does not carry it, and the count is fetched apart.
	const [total, setTotal] = useState<number | null>(() => initialTotal(initialPage, getMessageQueryParams(folder, mailboxId, filters, folderId)));
	const [hasMore, setHasMore] = useState(() => initialPage
		? hasNextMessagePage(initialPage, initialPage.offset ?? 0, initialPage.messages?.length ?? 0)
		: false);
	// Which view `total` belongs to, so paging and refreshes keep it while a new count loads.
	const totalKey = useRef<string | null>(initialPage ? getMessageTotalKey(getMessageQueryParams(folder, mailboxId, filters, folderId)) : null);
	const [limit, setLimit] = useState(initialPage?.limit ?? filters?.limit ?? 25);
	const [offset, setOffset] = useState(initialPage?.offset ?? filters?.offset ?? 0);

	const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read).length;

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		let refreshTimer: number | null = null;
		let requestNumber = 0;
		async function loadMessages(force = false, showLoading = false) {
			const currentRequest = ++requestNumber;
			if (showLoading) setIsLoading(true);
			try {
				const params = getMessageQueryParams(folder, mailboxId, filters, folderId);
				const data = await fetchMessageList(params, force);
				if (!cancelled && currentRequest === requestNumber) {
					const pageOffset = data.offset ?? filters?.offset ?? 0;
					setMessages(data.messages ?? []);
					setHasMore(hasNextMessagePage(data, pageOffset, data.messages?.length ?? 0));
					setLimit(data.limit ?? filters?.limit ?? 25);
					setOffset(pageOffset);
					const key = getMessageTotalKey(params);
					const sameView = totalKey.current === key;
					totalKey.current = key;
					if (typeof data.total === "number") {
						rememberMessageTotal(params, data.total);
						setTotal(data.total);
					} else {
						const known = peekMessageTotal(params);
						if (known !== undefined) setTotal(known);
						else {
							// Keep this view's last total on screen until the new count arrives.
							if (!sameView) setTotal(null);
							void fetchMessageTotal(params).then((counted) => {
								if (!cancelled && currentRequest === requestNumber && counted !== null) setTotal(counted);
							});
						}
					}
				}
			} finally {
				if (!cancelled && currentRequest === requestNumber) setIsLoading(false);
			}
		}

		void loadMessages(false, !peekMessageList(getMessageQueryParams(folder, mailboxId, filters, folderId)));
		function patchReadState(event: Event) {
			const detail = (event as CustomEvent<{ kind?: string; messageIds?: string[]; read?: boolean }>).detail;
			if (detail?.kind !== "read" || !detail.messageIds?.length) return;
			const ids = new Set(detail.messageIds);
			const read = detail.read !== false;
			setMessages((current) => current.map((message) => {
				if (message.threadMessageIds) {
					// Only the flipped members change a conversation row's unread count.
					const threadSize = message.threadMessageIds.length;
					const flipped = message.threadMessageIds.reduce((total, id) => total + (ids.has(id) ? 1 : 0), 0);
					if (!flipped) return message;
					const threadUnread = Math.min(threadSize, Math.max(0, (message.threadUnread ?? 0) + (read ? -flipped : flipped)));
					return { ...message, read: threadUnread === 0, threadUnread };
				}
				return ids.has(message.id) ? { ...message, read } : message;
			}));
		}
		function onMessagesChanged(event: Event) {
			const readOnly = (event as CustomEvent<{ kind?: string }>).detail?.kind === "read";
			// Read flips patch in place; "unread only" still needs a server refetch.
			if (readOnly && filters?.read !== "unread") return;
			if (!readOnly) {
				clearMessageListCache();
				clearMessageCountsCache();
			}
			if (document.visibilityState !== "visible") return;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				refreshTimer = null;
				void loadMessages(true);
			}, REFRESH_DEBOUNCE_MS);
		}
		window.addEventListener("mailclaw:messages-changed", onMessagesChanged);
		window.addEventListener("mailclaw:messages-changed", patchReadState);

		return () => {
			cancelled = true;
			window.removeEventListener("mailclaw:messages-changed", onMessagesChanged);
			window.removeEventListener("mailclaw:messages-changed", patchReadState);
			if (refreshTimer) window.clearTimeout(refreshTimer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on every field of `filters` (callers pass a new object each render, which would refetch on every render)
	}, [enabled, filters?.group, filters?.limit, filters?.offset, filters?.query, filters?.read, filters?.title, folder, folderId, mailboxId]);

	return { messages, unreadCount, isLoading, total, hasMore, limit, offset, updateMessages: setMessages };
}
