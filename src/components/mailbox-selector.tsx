"use client";
import { alertDialog, confirmDestructive } from "@/components/ui/confirm-dialog";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, Settings, ShieldCheck, UserPlus, UserRound, UsersRound } from "@/components/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eyebrow } from "@orangesys/ui";
import { useDismissible } from "@/components/use-dismissible";
import { AppsMenu } from "@/components/apps-menu";
import { useLanguage } from "@/components/language-provider";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { isIdentityMailbox } from "@/components/mailbox-provider-utils";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { clearCurrentUserCache, fetchCurrentUser } from "@/hooks/use-current-user";
import { getAvatarColorStyle } from "@/lib/avatar-colors";
import { logoutClientSession } from "@/lib/auth/logout";
import { fetchBrowserAccounts, switchBrowserAccount, signOutBrowserAccount, type BrowserAccount } from "@/lib/auth/accounts-client";
import {
	PROFILE_AVATAR_CHANGED_EVENT,
	getProfileAvatarUrl,
} from "@/lib/profile/avatar-client";
import { PROFILE_NAME_CHANGED_EVENT } from "@/lib/profile/name-client";
import type { ProfileAvatarChangedDetail, ProfileNameChangedDetail } from "@/lib/profile/types";
import { MAILBOX_AVATAR_CHANGED_EVENT } from "@/lib/mailboxes/avatar-client";
import type { MailboxAvatarChangedDetail } from "@/lib/mailboxes/avatar-client-types";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import type {
	AccountAvatarProps,
	MailboxAccountRowProps,
	MailboxSelectorUser,
	MailboxSelectorProps,
} from "./mailbox-selector-types";
import {
	getAccountInitial,
	getMailboxAddress,
	getMailboxName,
	isAdminPath,
} from "./mailbox-selector-utils";

// A server-rendered trigger has no click handler until hydration. Keep it a
// real link for that window so the first click is never lost.
const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

function AccountAvatar({
	name,
	colorSeed = name,
	hasAvatar = false,
	avatarUrl = "/api/profile/avatar",
	size = "small",
	placeholder = false,
	onAvatarError,
}: AccountAvatarProps) {
	const { t } = useLanguage();
	const sizeClass = size === "large" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";
	const iconClass = size === "large" ? "h-7 w-7" : "h-5 w-5";
	const [imageFailed, setImageFailed] = useState(false);
	const [prevImage, setPrevImage] = useState({ avatarUrl, hasAvatar });
	if (avatarUrl !== prevImage.avatarUrl || hasAvatar !== prevImage.hasAvatar) {
		setPrevImage({ avatarUrl, hasAvatar });
		setImageFailed(false);
	}

	if (hasAvatar && !imageFailed) {
		return (
			<ProgressiveAvatarImage
				src={avatarUrl}
				alt={t("account.profilePicture", { name })}
				className={`${sizeClass} shrink-0 rounded-full border border-line-subtle object-cover`}
				skipPreview={size === "small"}
				onError={() => {
					setImageFailed(true);
					onAvatarError?.();
				}}
			/>
		);
	}

	// The account name is not the mailbox identity; showing its initial first
	// makes the chip flip (D -> S). Until the mailbox loads, use a neutral icon.
	if (placeholder) {
		return (
			<div
				className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-surface-active text-fg-subtle`}
				aria-hidden="true"
			>
				<UserRound className={iconClass} />
			</div>
		);
	}

	return (
		<div
			className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-surface-active font-display font-semibold text-fg`}
			style={getAvatarColorStyle(colorSeed)}
			aria-hidden="true"
		>
			{getAccountInitial(name)}
		</div>
	);
}

function MailboxAccountRow({ mailbox, unread, avatarUrl, onSelect }: MailboxAccountRowProps) {
	const { t } = useLanguage();
	const name = getMailboxName(mailbox);

	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-hover active:bg-surface-active"
		>
			<AccountAvatar
				name={name}
				colorSeed={getMailboxAddress(mailbox)}
				hasAvatar={!!mailbox.hasAvatar || !!avatarUrl}
				avatarUrl={avatarUrl ?? `/api/mailboxes/${mailbox.id}/avatar`}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<p className="truncate text-sm font-semibold text-fg">{name}</p>
					{mailbox.type === "shared" && (
						<Tooltip label={t("account.sharedInbox")}>
							<span title={t("account.sharedInbox")} aria-label={t("account.sharedInbox")} className="shrink-0 text-fg-subtle">
								<UsersRound className="h-3.5 w-3.5" />
							</span>
						</Tooltip>
					)}
				</div>
				<p className="truncate text-xs text-fg-subtle">{getMailboxAddress(mailbox)}</p>
			</div>
			{unread > 0 && (
				<span className="min-w-5 rounded-full bg-accent-subtle px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-accent-text">
					{unread > 99 ? "99+" : unread}
				</span>
			)}
		</button>
	);
}

export function MailboxSelector({ initialUser }: MailboxSelectorProps = {}) {
	const { t } = useLanguage();
	const { selectedMailbox, setSelectedMailbox, mailboxes, isLoading } = useSelectedMailbox();
	const pathname = usePathname();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [user, setUser] = useState<MailboxSelectorUser | null>(initialUser ?? null);
	const [hasAvatar, setHasAvatar] = useState(!!initialUser?.hasAvatar);
	const [avatarUrl, setAvatarUrl] = useState("/api/profile/avatar");
	const [mailboxAvatarUrls, setMailboxAvatarUrls] = useState<Record<string, string>>({});
	const [inboxesOpen, setInboxesOpen] = useState(false);
	const [browserAccounts, setBrowserAccounts] = useState<BrowserAccount[]>([]);
	const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);

	useEffect(() => {
		if (!open) return;
		let active = true;
		void fetchBrowserAccounts().then((accounts) => {
			if (active) setBrowserAccounts(accounts);
		});
		return () => {
			active = false;
		};
	}, [open]);
	const otherAccounts = browserAccounts.filter((account) => !account.active && account.userId !== user?.id);
	const ref = useRef<HTMLDivElement>(null);
	const { counts } = useMessageCounts(null, open);

	useDismissible(open, () => setOpen(false), ref);

	useEffect(() => {
		// The landing page passes the account the server already resolved; fetching
		// it again here would duplicate the same /api/auth/me request.
		if (initialUser) return;
		let active = true;
		void fetchCurrentUser()
			.then((user) => {
				if (!active) return;
				setUser(user);
				setHasAvatar(!!user?.hasAvatar);
			})
			.catch(() => { if (active) setUser(null); });
		return () => { active = false; };
	}, [initialUser]);

	useEffect(() => {
		function onAvatarChanged(event: Event) {
			clearCurrentUserCache();
			const detail = (event as CustomEvent<ProfileAvatarChangedDetail>).detail;
			setAvatarUrl(detail?.url ?? getProfileAvatarUrl());
			setHasAvatar(true);
			setMailboxAvatarUrls((current) => {
				const next = { ...current };
				const version = Date.now();
				for (const mailbox of mailboxes) {
					if (isIdentityMailbox(mailbox)) {
						next[mailbox.id] = `/api/mailboxes/${mailbox.id}/avatar?v=${version}`;
					}
				}
				return next;
			});
		}

		window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
		return () => window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, onAvatarChanged);
	}, [mailboxes]);

	useEffect(() => {
		function onNameChanged(event: Event) {
			clearCurrentUserCache();
			const { name } = (event as CustomEvent<ProfileNameChangedDetail>).detail;
			setUser((current) => current ? { ...current, name } : current);
		}

		window.addEventListener(PROFILE_NAME_CHANGED_EVENT, onNameChanged);
		return () => window.removeEventListener(PROFILE_NAME_CHANGED_EVENT, onNameChanged);
	}, []);

	useEffect(() => {
		function onMailboxAvatarChanged(event: Event) {
			const detail = (event as CustomEvent<MailboxAvatarChangedDetail>).detail;
			if (!detail?.mailboxId || !detail.url) return;
			setMailboxAvatarUrls((current) => ({
				...current,
				[detail.mailboxId]: detail.url,
			}));
		}

		window.addEventListener(MAILBOX_AVATAR_CHANGED_EVENT, onMailboxAvatarChanged);
		return () => window.removeEventListener(MAILBOX_AVATAR_CHANGED_EVENT, onMailboxAvatarChanged);
	}, []);

	if (isLoading && !initialUser) {
		return <Skeleton className="h-10 w-10 rounded-full" />;
	}

	const selectedName = selectedMailbox ? getMailboxName(selectedMailbox) : user?.name ?? t("account.fallbackName");
	const selectedEmail = selectedMailbox ? getMailboxAddress(selectedMailbox) : user?.email ?? "";
	const selectedMailboxAvatarUrl = selectedMailbox
		? mailboxAvatarUrls[selectedMailbox.id]
		: undefined;
	const selectedHasAvatar = selectedMailbox
		? !!selectedMailbox.hasAvatar || !!selectedMailboxAvatarUrl
		: hasAvatar;
	const selectedAvatarUrl = selectedMailbox
		? selectedMailboxAvatarUrl ?? `/api/mailboxes/${selectedMailbox.id}/avatar`
		: avatarUrl;
	const identityPending = isLoading && !selectedMailbox;
	const otherMailboxes = mailboxes.filter((mailbox) => mailbox.id !== selectedMailbox?.id);
	const adminActive = isAdminPath(pathname);

	async function logout() {
		const switched = await logoutClientSession();
		setOpen(false);
		router.replace(switched ? "/inbox" : "/login");
		router.refresh();
	}

	async function signOutAccount(account: BrowserAccount) {
		if (!await confirmDestructive(t("account.signOutAccountConfirm", { name: account.name, email: account.email }))) return;
		const error = await signOutBrowserAccount(account.userId);
		if (error) {
			void alertDialog(error);
			return;
		}
		setBrowserAccounts((accounts) => accounts.filter((item) => item.userId !== account.userId));
	}

	async function switchAccount(userId: string) {
		const error = await switchBrowserAccount(userId);
		setOpen(false);
		if (error) {
			router.push("/login?add=1");
			return;
		}
		router.replace("/inbox");
		router.refresh();
	}

	const triggerAvatar = (
		<AccountAvatar
			name={selectedName}
			colorSeed={selectedEmail || selectedName}
			hasAvatar={selectedHasAvatar}
			avatarUrl={selectedAvatarUrl}
			placeholder={identityPending}
			onAvatarError={() => {
				if (!selectedMailbox) setHasAvatar(false);
			}}
		/>
	);

	return (
		<div className="flex items-center gap-1">
		<AppsMenu user={user} />
		<div ref={ref} className="relative">
			{hydrated ? (
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					className="rounded-full p-1 transition-colors hover:bg-surface-hover"
					aria-label={t("account.openMenu")}
					aria-expanded={open}
				>
					{triggerAvatar}
				</button>
			) : (
				<Link
					href="/inbox"
					className="inline-flex rounded-full p-1 transition-colors hover:bg-surface-hover"
					aria-label={t("navigation.inbox")}
				>
					{triggerAvatar}
				</Link>
			)}

			{open && (
				<div className="absolute end-0 top-14 z-90 max-h-[82vh] w-[360px] max-w-[calc(100vw-1rem)] overflow-y-auto border border-line bg-surface-raised shadow-lg">
					<div className="p-2">
						<Link
							href="/inbox"
							onClick={() => setOpen(false)}
							className="flex items-center gap-4 px-3 py-3 transition-colors hover:bg-surface-hover active:bg-surface-active"
						>
							<AccountAvatar
								name={selectedName}
								colorSeed={selectedEmail || selectedName}
								hasAvatar={selectedHasAvatar}
								avatarUrl={selectedAvatarUrl}
								size="large"
								placeholder={identityPending}
								onAvatarError={() => {
									if (!selectedMailbox) setHasAvatar(false);
								}}
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<p className="truncate font-display text-lg font-semibold text-fg">{selectedName}</p>
									{selectedMailbox?.type === "shared" && (
										<Tooltip label={t("account.sharedInbox")}>
											<span title={t("account.sharedInbox")} aria-label={t("account.sharedInbox")} className="shrink-0 text-fg-subtle">
												<UsersRound className="h-4 w-4" />
											</span>
										</Tooltip>
									)}
								</div>
								<p className="truncate text-sm text-fg-subtle">
									{selectedEmail}
								</p>
							</div>
							<Check className="h-5 w-5 shrink-0 text-accent-text" />
						</Link>
						{otherMailboxes.length > 0 && (
							<div className="mt-2 border-t border-line-subtle pt-2">
								<button
									type="button"
									onClick={() => setInboxesOpen((value) => !value)}
									aria-expanded={inboxesOpen}
									className="flex w-full items-center justify-between px-3 py-2 text-fg-subtle hover:bg-surface-hover hover:text-fg"
								>
									<Eyebrow as="span" className="text-inherit">{t("account.inboxes", { count: otherMailboxes.length })}</Eyebrow>
									<ChevronDown size={16} className={`transition-transform motion-reduce:transition-none ${inboxesOpen ? "rotate-180" : ""}`} />
								</button>
								{inboxesOpen && otherMailboxes.map((mailbox) => {
									const mailboxCount = counts.mailboxes.find((count) => count.mailboxId === mailbox.id);
									return (
										<MailboxAccountRow
											key={mailbox.id}
											mailbox={mailbox}
											unread={mailboxCount?.unread ?? 0}
											avatarUrl={mailboxAvatarUrls[mailbox.id]}
											onSelect={() => {
												setSelectedMailbox(mailbox);
												setOpen(false);
												router.push("/inbox");
											}}
										/>
									);
								})}
							</div>
						)}
					</div>

					<div className="border-t border-line">
						{otherAccounts.length > 0 && (
							<Eyebrow className="px-4 pb-1 pt-3">
								{t("account.otherAccounts")}
							</Eyebrow>
						)}
						<div className="divide-y divide-line-subtle">
							{otherAccounts.map((account) => (
								<div
									key={account.userId}
									className="group flex items-center transition-colors hover:bg-surface-hover focus-within:bg-surface-hover"
								>
									<button
										type="button"
										onClick={() => void switchAccount(account.userId)}
										className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-start"
									>
										<AccountAvatar
											name={account.name}
											colorSeed={account.email}
											hasAvatar={account.hasAvatar}
											avatarUrl={`/api/auth/accounts/${account.userId}/avatar`}
										/>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold text-fg">{account.name}</p>
											<p className="truncate text-xs text-fg-subtle">{account.email}</p>
										</div>
									</button>
									<Tooltip label={t("account.signOut")}>
										<button
											type="button"
											onClick={() => void signOutAccount(account)}
											className="me-3 flex h-8 w-8 shrink-0 items-center justify-center text-fg-subtle opacity-0 transition-opacity hover:bg-surface-active hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
											aria-label={t("account.signOut")}
										>
											<LogOut size={16} />
										</button>
									</Tooltip>
								</div>
							))}
							<Link
								href="/login?add=1"
								onClick={() => setOpen(false)}
								className="flex items-center gap-3 px-4 py-3 text-sm font-medium text-fg transition-colors hover:bg-surface-hover active:bg-surface-active"
							>
								<UserPlus size={18} className="text-fg-muted" />
								{t("account.addAnother")}
							</Link>
						</div>
					</div>

					<div className="border-t border-line">
						<Link
							href="/settings/account"
							onClick={() => setOpen(false)}
							className="flex items-center gap-3 px-5 py-4 text-sm font-medium text-fg hover:bg-surface-hover"
						>
							<Settings size={18} className="text-fg-muted" />
							{t("account.settings")}
						</Link>
						{user?.role === "admin" && (
							<Link
								href="/admin"
								onClick={() => setOpen(false)}
								className={`relative flex items-center gap-3 border-t border-line-subtle px-5 py-4 text-sm font-medium ${adminActive ? "bg-accent-subtle text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent" : "text-fg hover:bg-surface-hover"}`}
							>
								<ShieldCheck size={18} className={adminActive ? undefined : "text-fg-muted"} />
								{t("account.admin")}
								{adminActive && <Check className="ms-auto h-4 w-4" />}
							</Link>
						)}
						<button
							type="button"
							onClick={logout}
							className="flex w-full items-center gap-3 border-t border-line-subtle px-5 py-4 text-start text-sm font-medium text-fg hover:bg-surface-hover"
						>
							<LogOut size={18} className="text-fg-muted" />
							{t("account.signOut")}
						</button>
					</div>
				</div>
			)}
		</div>
		</div>
	);
}
