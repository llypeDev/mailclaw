"use client";

import Link from "next/link";
import { confirmDestructive, alertDialog } from "@/components/ui/confirm-dialog";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { EmptyState } from "@orangesys/ui";
import { Archive, ChevronLeft, ChevronRight, ListFilter, Mail, MailOpen, Search, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { usePageLoading } from "@/components/page-loading";
import { formatScheduledSendTime } from "./scheduled-send-utils";
import { useIsMobile } from "@/components/sidebar-mobile-utils";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { useMessages } from "@/hooks/use-messages";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { Message } from "@/hooks/types";
import { setMessageDragData } from "@/lib/messages/drag-utils";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import { useMessageListState } from "./message-list-state";
import { SwipeableRow } from "./swipeable-row";
import { MessageListRowActions } from "./message-list-row-actions";
import { dispatchMessageCountsDelta, toggleMessageStar } from "./message-list-row-actions-utils";
import { useMessageNavigation } from "./message-navigation";
import { rememberOpenedUnreadMessage } from "./message-detail-navigation-utils";
import { useConversationView } from "./use-conversation-view";
import { OpenedIndicator } from "./message-open-status";
import { MessageNotesPopover, NoteBadge } from "./message-notes-popover";
import type { MessageFolderPageProps, MessageListRowProps, RowMessageAction } from "./types";
import {
	formatMessageListTimestamp,
	getPageRange,
	getMessageParty,
	getMessagePartyClassName,
	getMessagePreview,
	getUnreadFlipCount,
	isMessageListRowUnread,
	formatEmailPageTitle,
	getMailboxAddress,
	runBulkMessageAction,
	emptyMessageFolder,
} from "./utils";
import {
	getEmptyFolderConfirmText,
	getEmptyFolderLabel,
	getPermanentDeleteFolderLabel,
	getPermanentDeleteConfirmText,
	PartialDeleteError,
	supportsPermanentDelete,
} from "@/lib/messages/permanent-delete-utils";
import clsx from "clsx";
import { DueFollowUps } from "@/components/follow-ups/due-follow-ups";
import { getUserTimeZone, zonedDateFields } from "@/lib/time/utils";

const pageSize = 25;
// The open message's row: a 2px accent bar on the start edge, over the accent-subtle fill.
const ROW_ACCENT_BAR = "before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent";

function getRowMessageIds(message: Message): string[] {
	return message.threadMessageIds ?? [message.id];
}

let todayCacheZone = "";
let todayCacheValue = "";
let todayCacheExpiresAt = 0;

function getTodayKey(): string {
	const zone = getUserTimeZone();
	const now = Date.now();
	if (todayCacheZone !== zone || now >= todayCacheExpiresAt) {
		todayCacheZone = zone;
		todayCacheExpiresAt = now + 60_000;
		todayCacheValue = zonedDateFields(new Date(now), zone).toISOString().slice(0, 10);
	}
	return todayCacheValue;
}

function MessageListRowComponent({
	message,
	config,
	selected,
	active = false,
	opening = false,
	compact = false,
	currentAccountName,
	onSelectedChange,
	onMessageAction,
	onOpening,
	dragMessageIds,
	todayKey,
}: MessageListRowProps) {
	const { t } = useLanguage();
	const Icon = config.icon;
	const [read, setRead] = useState(message.read);
	const [threadUnread, setThreadUnread] = useState(message.threadUnread);
	const [starred, setStarred] = useState(message.starred);
	// Follow server updates to each flag independently, keeping local optimistic values otherwise.
	const [prevFlags, setPrevFlags] = useState({ read: message.read, threadUnread: message.threadUnread, starred: message.starred });
	if (message.read !== prevFlags.read || message.threadUnread !== prevFlags.threadUnread || message.starred !== prevFlags.starred) {
		setPrevFlags({ read: message.read, threadUnread: message.threadUnread, starred: message.starred });
		if (message.read !== prevFlags.read) setRead(message.read);
		if (message.threadUnread !== prevFlags.threadUnread) setThreadUnread(message.threadUnread);
		if (message.starred !== prevFlags.starred) setStarred(message.starred);
	}
	const rowMessage = useMemo(
		() => ({ ...message, read, starred, threadUnread }),
		[message, read, starred, threadUnread],
	);
	const unread = isMessageListRowUnread(rowMessage);
	const draggable = config.folder === "inbox" && message.direction === "inbound";
	const party = getMessageParty(rowMessage, config.folder, currentAccountName, t);
	const preview = getMessagePreview(rowMessage, config.folder, t);
	const href = `${config.hrefPrefix}/${message.id}`;
	const navigation = useMessageNavigation(href, rowMessage);

	const affectsInboxCount = config.folder === "inbox" && !config.folderId;

	const runRowAction = useCallback(async (action: RowMessageAction) => {
		const previousRead = read;
		const previousThreadUnread = threadUnread;
		const unreadDelta = !affectsInboxCount || (action !== "read" && action !== "unread")
			? 0
			: getUnreadFlipCount(rowMessage, action === "read") * (action === "read" ? -1 : 1);
		if (action === "read") setRead(true);
		if (action === "unread") setRead(false);
		// Grouped rows derive their unread styling from the thread count, so it must change with the row.
		if (message.threadMessageIds) {
			if (action === "read") setThreadUnread(0);
			if (action === "unread") setThreadUnread(message.threadMessageIds.length);
		}
		if (unreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: unreadDelta });
		try {
			await onMessageAction(message.id, action);
		} catch (error) {
			if (action === "read" || action === "unread") {
				setRead(previousRead);
				setThreadUnread(previousThreadUnread);
				if (unreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: -unreadDelta });
			}
			throw error;
		}
	}, [affectsInboxCount, message.id, message.threadMessageIds, onMessageAction, read, rowMessage, threadUnread]);

	const swipeable = compact && (config.folder === "inbox" || config.folder === "snoozed") && message.direction === "inbound";

	function onMessageNavigate(event: MouseEvent<HTMLAnchorElement>) {
		const plainClick = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
		if (plainClick) onOpening?.(message.id);
		if (!read && plainClick) {
			rememberOpenedUnreadMessage(message.id);
			const previousThreadUnread = threadUnread;
			setRead(true);
			if (previousThreadUnread !== undefined) setThreadUnread(Math.max(0, previousThreadUnread - 1));
			if (affectsInboxCount && message.direction === "inbound") dispatchMessageCountsDelta({ inboxUnreadDelta: -1 });
			void runBulkMessageAction([message.id], "read", false).catch(() => {
				setRead(false);
				setThreadUnread(previousThreadUnread);
				if (affectsInboxCount && message.direction === "inbound") dispatchMessageCountsDelta({ inboxUnreadDelta: 1 });
			});
		}
		navigation.onNavigate(event, !read);
	}

	if (compact) {
		const compactRow = (
			<div
				role={swipeable ? undefined : "listitem"}
				className={clsx(
					"group relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 px-4 py-3 transition-colors",
					active || opening
						? clsx("bg-accent-subtle", ROW_ACCENT_BAR)
						: selected
							? "bg-accent-subtle"
							: "hover:bg-surface-hover",
					draggable && "cursor-grab active:cursor-grabbing",
				)}
				draggable={draggable}
				onDragStart={(event) => {
					if (!draggable) return;
					setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds ?? message.threadMessageIds ?? [message.id] });
				}}
			>
				<Checkbox
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					aria-label={t("list.selectFrom", { sender: party })}
				/>
				<Link
					href={href}
					onClick={config.folder === "drafts" ? undefined : onMessageNavigate}
					onPointerEnter={config.folder === "drafts" ? undefined : navigation.prefetch}
					onPointerLeave={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onFocus={config.folder === "drafts" ? undefined : navigation.prefetch}
					onBlur={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onTouchStart={config.folder === "drafts" ? undefined : navigation.prefetchNow}
					aria-current={active ? "true" : undefined}
					className="min-w-0"
				>
					<span className="flex items-baseline justify-between gap-3">
						<span className={clsx(unread && "font-semibold",getMessagePartyClassName(rowMessage, config.folder))}>
							{unread && <span className="sr-only">{t("list.unread")} </span>}
							{party}

							{(message.threadCount ?? 1) > 1 && (
								<span className="ms-2 text-xs font-normal tabular-nums text-fg-subtle">{message.threadCount}</span>
							)}
							<NoteBadge count={message.noteCount} className="ms-2" />
						</span>
						<span className={clsx(unread ? "font-semibold text-fg" : "text-fg-subtle", "shrink-0 text-[11px] tabular-nums")}>
							<OpenedIndicator count={message.openCount} />
							{message.scheduledAt ? formatScheduledSendTime(message.scheduledAt, t) : formatMessageListTimestamp(message.createdAt, todayKey)}
						</span>
					</span>
					<span
						className={clsx("mt-1 block truncate text-sm", unread ? "font-semibold text-fg" : "text-fg-muted")}
					>
						{message.subject ?? t("list.noSubject")}
					</span>
					<span className="mt-0.5 block truncate text-xs leading-5 text-fg-subtle">
						{preview}
					</span>
				</Link>
			</div>
		);
		if (!swipeable) return compactRow;
		return (
			<SwipeableRow
				role="listitem"
				startAction={{
					label: read ? t("list.markUnread") : t("list.markRead"),
					icon: read ? Mail : MailOpen,
					className: "bg-accent text-on-accent",
					onTrigger: () => void runRowAction(read ? "unread" : "read").catch(() => undefined),
				}}
				endAction={{
					label: t("common.archive"),
					icon: Archive,
					className: "bg-success text-on-success",
					onTrigger: () => void runRowAction("archive").catch(() => undefined),
				}}
			>
				{compactRow}
			</SwipeableRow>
		);
	}

	const className = clsx(
		"group relative grid min-h-12 w-full grid-cols-[24px_32px_minmax(160px,80px)_1fr_auto] items-center gap-3 px-6 text-start text-sm hover:z-10 hover:bg-surface-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-inset has-[a:focus-visible]:ring-focus",
		(active || selected || opening) && "bg-accent-subtle",
		(active || opening) && ROW_ACCENT_BAR,
		draggable && "cursor-grab active:cursor-grabbing",
	);
	const content = (
		<>
			{config.folder === "inbox" && message.direction === "inbound" && (
				<Tooltip label={starred ? t("list.starred") : t("list.notStarred")}>
					<Button
						type="button"
						variant="ghost"
						size="roundedSM"
						className="relative z-10"
						onClick={() => {
							void toggleMessageStar(message.id).then((result) => setStarred(result.starred));
						}}
						aria-label={t("message.star")}
						aria-pressed={starred}
					>
						<Icon className={`h-4 w-4 ${starred ? "fill-warning text-warning-text" : "text-fg-disabled"}`} />
					</Button>
				</Tooltip>
			)}
			{(config.folder !== "inbox" || message.direction !== "inbound") && (
				<Icon className="h-4 w-4 text-fg-disabled" />
			)}
			<span className={clsx(unread && "font-semibold", getMessagePartyClassName(rowMessage, config.folder))}>
				{unread && <span className="sr-only">{t("list.unread")} </span>}
				{party}

				{(message.threadCount ?? 1) > 1 && (
					<span className="ms-2 text-xs tabular-nums text-fg-subtle">{message.threadCount}</span>
				)}
			</span>
			<span className="flex min-w-0 items-center text-fg-muted">
				{/* A fixed slot keeps every subject aligned, with or without notes. */}
				<span className="w-11 shrink-0">
					{message.noteCount ? <MessageNotesPopover messageId={message.id} count={message.noteCount} preview={message.notePreview} /> : null}
				</span>
				<Link
					href={href}
					onClick={config.folder === "drafts" ? undefined : onMessageNavigate}
					onPointerEnter={config.folder === "drafts" ? undefined : navigation.prefetch}
					onPointerLeave={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onFocus={config.folder === "drafts" ? undefined : navigation.prefetch}
					onBlur={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onTouchStart={config.folder === "drafts" ? undefined : navigation.prefetchNow}
					aria-current={active ? "true" : undefined}
					className="min-w-0 truncate focus-visible:outline-none after:absolute after:inset-0"
				>
					<span className={unread ? "font-semibold text-fg" : ""}>
						{rowMessage.subject ?? t("list.noSubject")}
					</span>
					<span className="text-fg-subtle"> - {getMessagePreview(rowMessage, config.folder, t)}</span>
				</Link>
			</span>
			<time
				dateTime={message.createdAt}
				className={clsx("min-w-[96px] whitespace-nowrap text-end text-xs tabular-nums group-hover:opacity-0", unread ? "font-semibold text-fg" : "text-fg-subtle")}
			>
				<OpenedIndicator count={message.openCount} />
				{message.scheduledAt ? formatScheduledSendTime(message.scheduledAt, t) : formatMessageListTimestamp(message.createdAt, todayKey)}
			</time>
		</>
	);

	if (config.folder === "drafts") {
		return (
			<div role="listitem" className={className}>
				<Checkbox
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					className="relative z-10"
					aria-label={t("list.selectMessage")}
				/>
				{content}
			</div>
		);
	}

	return (
		<div
			role="listitem"
			className={className}
			draggable={draggable}
			onDragStart={(event) => {
				if (!draggable) return;
				setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds ?? message.threadMessageIds ?? [message.id] });
			}}
		>
			<Checkbox
				checked={selected}
				onChange={(event) => onSelectedChange(message.id, event.target.checked)}
				className="relative z-10"
				aria-label={t("list.selectFrom", { sender: party })}
			/>
			{content}
			{(config.folder === "inbox" || config.folder === "snoozed") && message.direction === "inbound" && (
				<MessageListRowActions
					message={rowMessage}
					onAction={runRowAction}
				/>
			)}
		</div>
	);
}

const MessageListRow = memo(MessageListRowComponent);

export function MessageFolderPage({
	config,
	compact = false,
	selectedMessageId,
}: MessageFolderPageProps) {
	const { t } = useLanguage();
	const title = config.titleKey ? t(config.titleKey) : config.title;
	const { selectedMailbox, isLoading: mailboxesLoading } = useSelectedMailbox();
	const { query } = useMailSearch();
	const isMobile = useIsMobile();
	const listState = useMessageListState();
	const usesSharedListState = listState !== null;
	const [internalOffset, setInternalOffset] = useState(0);
	const [internalSelectedMessages, setInternalSelectedMessages] = useState<
		Array<{ id: string; read: boolean }>
	>([]);
	const [internalUnreadOnly, setInternalUnreadOnly] = useState(false);
	const [pendingBulkAction, setPendingBulkAction] = useState(false);
	const [emptyingFolder, setEmptyingFolder] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [openingMessageId, setOpeningMessageId] = useState<string | null>(null);
	const openingTimer = useRef<number | null>(null);
	const [conversationView] = useConversationView();
	const visibleOpeningMessageId = openingMessageId === selectedMessageId ? null : openingMessageId;
	const todayKey = getTodayKey();

	useEffect(() => () => {
		if (openingTimer.current) window.clearTimeout(openingTimer.current);
	}, []);

	const markMessageOpening = useCallback((messageId: string) => {
		setOpeningMessageId(messageId);
		if (openingTimer.current) window.clearTimeout(openingTimer.current);
		openingTimer.current = window.setTimeout(() => setOpeningMessageId(null), 3000);
	}, []);
	const grouped = conversationView && config.folder !== "drafts";
	const offset = listState?.offset ?? internalOffset;
	const setOffset = listState?.setOffset ?? setInternalOffset;
	const selectedMessages = listState?.selectedMessages ?? internalSelectedMessages;
	const setSelectedMessages = listState?.setSelectedMessages ?? setInternalSelectedMessages;
	const unreadOnly = listState?.unreadOnly ?? internalUnreadOnly;
	const setUnreadOnly = listState?.setUnreadOnly ?? setInternalUnreadOnly;
	const { messages, isLoading, total, hasMore, limit, updateMessages } = useMessages(config.folder, selectedMailbox?.id, {
		query,
		limit: pageSize,
		offset,
		read: unreadOnly ? "unread" : "all",
		group: grouped ? "thread" : undefined,
	}, !mailboxesLoading, config.folderId);
	const { counts } = useMessageCounts(selectedMailbox?.id, !mailboxesLoading);
	usePageLoading(mailboxesLoading || isLoading, true);
	const headerIcons = config.headerIcons ?? [];
	const EmptyIcon = config.icon;
	const hasActiveFilters = !!query.trim();
	const folderCount = config.folderId
		? counts.customFolders[config.folderId]
		: counts.folders[config.folder];
	const titleTotal = folderCount?.total ?? total ?? 0;
	const titleUnread = folderCount?.unread ?? 0;
	const mailboxAddress = getMailboxAddress(selectedMailbox);
	const currentAccountName = selectedMailbox?.displayName ?? selectedMailbox?.localPart;
	// Until the view's count arrives the range has no total yet; the page itself still knows its rows.
	const pageRange = total === null
		? { ...getPageRange(offset, messages.length, offset + messages.length), total: messages.length ? "…" : 0 }
		: getPageRange(offset, messages.length, total);
	const selectedIds = useMemo(
		() => selectedMessages.map((message) => message.id),
		[selectedMessages],
	);
	const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	const allVisibleSelected = messages.length > 0 && messages.every((message) => selectedIdSet.has(message.id));
	// In conversation view a row stands for every message of its thread in this
	// folder, so actions and drags carry all of them.
	const expandSelectedIds = useCallback(
		(ids: string[]) =>
			ids.flatMap((id) => getRowMessageIds(messages.find((message) => message.id === id) ?? { id } as Message)),
		[messages],
	);
	const selectedDragIds = useMemo(() => expandSelectedIds(selectedIds), [expandSelectedIds, selectedIds]);

	// A split-layout list keeps this state in MessageSplitLayout, which resets
	// it when the list view changes. Standalone lists (drafts) own it here.
	useEffect(() => {
		if (usesSharedListState) return;
		setOffset(0);
		setSelectedMessages([]);
	}, [usesSharedListState, query, selectedMailbox?.id, config.folder, config.folderId, unreadOnly, grouped, setOffset, setSelectedMessages]);

	const previousOffset = useRef(offset);
	useEffect(() => {
		if (previousOffset.current === offset) return;
		previousOffset.current = offset;
		setSelectedMessages([]);
	}, [offset, setSelectedMessages]);

	useEffect(() => {
		const originalTitle = document.title;
		return () => {
			document.title = originalTitle;
		};
	}, []);

	useEffect(() => {
		if (mailboxesLoading) return;
		document.title = formatEmailPageTitle({
			location: title,
			inbox: config.folder === "inbox" && !config.folderId,
			total: titleTotal,
			unread: titleUnread,
			emailAddress: mailboxAddress,
		});
	}, [title, config.folder, config.folderId, mailboxAddress, mailboxesLoading, titleTotal, titleUnread]);

	useEffect(() => {
		if (isLoading) return;
		setSelectedMessages((current) => {
			const remaining = current.filter((item) => messages.some((message) => message.id === item.id));
			return remaining.length === current.length ? current : remaining;
		});
	}, [messages, isLoading, setSelectedMessages]);

	useEffect(() => {
		if (isLoading || offset === 0 || messages.length > 0) return;
		setOffset(total ? Math.floor((total - 1) / limit) * limit : 0);
	}, [isLoading, offset, messages.length, total, limit, setOffset]);

	const updateSelectedMessage = useCallback((messageId: string, selected: boolean) => {
		const message = messages.find((item) => item.id === messageId);
		if (!message) return;

		setSelectedMessages((current) => {
			if (!selected) return current.filter((item) => item.id !== messageId);
			if (current.some((item) => item.id === messageId)) return current;
			return [...current, { id: message.id, read: message.read && !(message.threadUnread ?? 0) }];
		});
	}, [messages, setSelectedMessages]);

	const handleMessageAction = useCallback((messageId: string, action: RowMessageAction) => {
		setActionError(null);
		return runBulkMessageAction(expandSelectedIds([messageId]), action, action !== "read" && action !== "unread").catch((error) => {
			setActionError(error instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
			throw error;
		});
	}, [expandSelectedIds, t]);

	function toggleAllVisible(selected: boolean) {
		const visibleIds = new Set(messages.map((message) => message.id));
		setSelectedMessages((current) => {
			if (!selected) {
				return current.filter((message) => !visibleIds.has(message.id));
			}

			const next = new Map(current.map((message) => [message.id, message]));
			for (const message of messages) {
				next.set(message.id, { id: message.id, read: message.read && !(message.threadUnread ?? 0) });
			}
			return Array.from(next.values());
		});
	}

	const permanentDeleteFolder = !config.folderId && supportsPermanentDelete(config.folder) ? config.folder : null;
	async function emptyFolder() {
		if (!permanentDeleteFolder || !selectedMailbox?.id) return;
		if (!await confirmDestructive(getEmptyFolderConfirmText(permanentDeleteFolder, titleTotal, t))) return;
		setEmptyingFolder(true);
		try {
			await emptyMessageFolder(selectedMailbox.id, permanentDeleteFolder);
			setOffset(0);
		} catch (error) {
			console.error(error);
			void alertDialog(t("list.emptyFailed", { folder: getPermanentDeleteFolderLabel(permanentDeleteFolder, t) }));
		} finally {
			setEmptyingFolder(false);
		}
	}

	useEffect(() => {
		if (!actionError) return;
		const timer = setTimeout(() => setActionError(null), 6000);
		return () => clearTimeout(timer);
	}, [actionError]);

	async function runSelectedActionReportingErrors(action: BulkMessageAction, folderId?: string) {
		setActionError(null);
		try {
			await runSelectedAction(action, folderId);
		} catch (error) {
			setActionError(error instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
		}
	}

	async function runSelectedAction(action: BulkMessageAction, folderId?: string) {
		if (selectedIds.length === 0) return;
		if (action === "delete") {
			const ids = expandSelectedIds(selectedIds);
			if (!await confirmDestructive(getPermanentDeleteConfirmText(ids.length, t))) return;
		}

		setPendingBulkAction(true);
		const previousMessages = messages;
		const readValue = action === "read" ? true : action === "unread" ? false : null;
		const inboxUnreadDelta = readValue === null || config.folder !== "inbox" || config.folderId
			? 0
			: messages
				.filter((message) => selectedIdSet.has(message.id))
				.reduce((total, message) => total + getUnreadFlipCount(message, readValue), 0) * (readValue ? -1 : 1);
		if (readValue !== null) {
			updateMessages((current) => current.map((message) =>
				selectedIdSet.has(message.id)
					? { ...message, read: readValue, ...(message.threadMessageIds ? { threadUnread: readValue ? 0 : message.threadMessageIds.length } : {}) }
					: message,
			));
			setSelectedMessages((current) => current.map((message) => ({ ...message, read: readValue })));
			if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta });
		}
		try {
			await runBulkMessageAction(expandSelectedIds(selectedIds), action, true, folderId);
			setSelectedMessages([]);
		} catch (error) {
			if (readValue !== null) {
				updateMessages(previousMessages);
				if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: -inboxUnreadDelta });
			}
			throw error;
		} finally {
			setPendingBulkAction(false);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className={`flex h-14 shrink-0 items-center justify-between border-b border-line ${compact ? "px-4" : "px-4.5 md:px-6"}`}>
				{selectedMessageId ? <h2 className="sr-only">{title}</h2> : <h1 className="sr-only">{title}</h1>}
				<div className="flex items-center gap-3 w-full">
					<Tooltip label={t("list.selectAll")}>
						<Checkbox
							checked={allVisibleSelected}
							disabled={messages.length === 0}
							onChange={(event) => toggleAllVisible(event.target.checked)}
							aria-label={t("list.selectAll")}
						/>
					</Tooltip>
					{selectedIds.length > 0 && !compact ? (
						<BulkMessageToolbar
							selectedCount={selectedIds.length}
							hasUnreadSelection={hasUnreadSelection}
							onAction={runSelectedActionReportingErrors}
							onClearSelection={() => setSelectedMessages([])}
							pending={pendingBulkAction}
							folder={config.folderId ? undefined : config.folder}
						/>
					) : (
						(compact || isMobile) && (
							<p aria-hidden="true" className="truncate font-display font-semibold text-fg ps-1">{title}</p>
						)
					)}
				</div>
				{(selectedIds.length === 0 || compact) && (
					<div className="flex items-center gap-2 text-fg-subtle">
						<span className="text-xs tabular-nums text-fg-subtle whitespace-nowrap">
							{t("list.range", { start: pageRange.start, end: pageRange.end, total: pageRange.total })}
						</span>
						<Tooltip label={t("list.previousPage")}>
							<Button
								variant="ghost"
								size="roundedSM"
								disabled={offset === 0 || isLoading}
								onClick={() => setOffset(Math.max(offset - limit, 0))}
								aria-label={t("list.previousPage")}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
						</Tooltip>
						<Tooltip label={t("list.nextPage")}>
							<Button
								variant="ghost"
								size="roundedSM"
								disabled={!hasMore || isLoading}
								onClick={() => setOffset(offset + limit)}
								aria-label={t("list.nextPage")}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</Tooltip>
						{config.folder === "inbox" && (
							<Tooltip label={unreadOnly ? t("list.showingUnread") : t("list.showUnreadOnly")}>
								<Button
									type="button"
									variant="ghost"
									size="roundedSM"
									aria-label={t("list.showUnreadOnly")}
									aria-pressed={unreadOnly}
									onClick={() => setUnreadOnly((current) => !current)}
									className={unreadOnly ? "bg-accent-subtle text-accent-text hover:bg-accent-subtle" : undefined}
								>
									<ListFilter className="h-4 w-4" />
								</Button>
							</Tooltip>
						)}
						{permanentDeleteFolder && (
							<Tooltip label={getEmptyFolderLabel(permanentDeleteFolder, t)}>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={getEmptyFolderLabel(permanentDeleteFolder, t)}
									disabled={emptyingFolder || isLoading || total === 0}
									onClick={() => void emptyFolder()}
									className="gap-1.5 text-xs font-medium text-danger-text hover:bg-danger-subtle hover:text-danger-text"
								>
									<Trash2 className="h-4 w-4" />
									{!compact && <span className="max-md:hidden">{emptyingFolder ? t("list.emptying") : getEmptyFolderLabel(permanentDeleteFolder, t)}</span>}
								</Button>
							</Tooltip>
						)}
						{!compact && headerIcons.map((Icon, index) => (
							<Icon key={index} className="h-4 w-4" />
						))}
					</div>
				)}
			</div>

			{actionError && (
				<p role="alert" className="shrink-0 border-b border-line border-s-2 border-s-danger bg-danger-subtle px-6 py-2 text-sm font-medium text-danger-text">
					{actionError}
				</p>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable">
				{config.folder === "inbox" && !config.folderId && offset === 0 && !mailboxesLoading && <DueFollowUps mailboxId={selectedMailbox?.id} />}
				<div role="list" aria-label={title} className="divide-y divide-line-subtle">
					{messages.map((message) => (
						<MessageListRow
							key={message.id}
							message={message}
							config={config}
							selected={selectedIdSet.has(message.id)}
							active={message.id === selectedMessageId}
							opening={message.id === visibleOpeningMessageId}
							onOpening={markMessageOpening}
							compact={compact || isMobile}
							currentAccountName={currentAccountName}
							onSelectedChange={updateSelectedMessage}
							onMessageAction={handleMessageAction}
							dragMessageIds={selectedIdSet.has(message.id) ? selectedDragIds : undefined}
							todayKey={todayKey}
						/>
					))}
				</div>
				{!isLoading && messages.length === 0 && (
					<EmptyState
						variant={compact || isMobile ? "compact" : "default"}
						animated={false}
						headingLevel={selectedMessageId ? 3 : 2}
						icon={hasActiveFilters ? <Search className="h-6 w-6" aria-hidden="true" /> : <EmptyIcon className="h-6 w-6" aria-hidden="true" />}
						title={hasActiveFilters ? t("list.noMatch") : config.emptyTextKey ? t(config.emptyTextKey) : config.emptyText}
					/>
				)}
			</div>
		</div>
	);
}
