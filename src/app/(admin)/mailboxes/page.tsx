"use client";

import { mobilePrimaryActionClass } from "@/components/page-header-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, EmptyState, Tag, type TagTone } from "@orangesys/ui";
import { Mail, Plus } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { List, ListRow } from "@/components/ui/list";
import { SectionRowSkeleton } from "@/components/page-skeletons";
import { clearMailboxesCache } from "@/components/mailbox-provider-utils";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { authFetch } from "@/lib/auth/client";
import { getAvatarColorStyle } from "@/lib/avatar-colors";
import { fetchSessionInfo } from "@/hooks/use-current-user";
import type { CurrentAccountResponse, Domain, MailboxOwner, MailboxesResponse } from "./types";
import { formatAccountDateTime } from "../accounts/utils";
import { getMailboxAddress, getMailboxesBase, getMailboxName } from "./utils";

const COLUMNS = "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";
const STATUS_TONES: Record<"active" | "disabled" | "pendingDeletion", TagTone> = {
	active: "success",
	disabled: "neutral",
	pendingDeletion: "danger",
};

export default function MailboxesPage() {
	const { t } = useLanguage();
	const qc = useQueryClient();
	const router = useRouter();
	const base = getMailboxesBase(usePathname());
	const [displayName, setDisplayName] = useState("");
	const [localPart, setLocalPart] = useState("");
	const [domainId, setDomainId] = useState("");
	const [ownerUserId, setOwnerUserId] = useState("");
	const [mailboxType, setMailboxType] = useState<"personal" | "shared">("personal");
	const [createOpen, setCreateOpen] = useState(false);

	const account = useQuery({
		queryKey: ["auth", "me"],
		// The session already cached by the auth guard, so opening the page does not refetch it.
		queryFn: async (): Promise<CurrentAccountResponse> => ({ user: (await fetchSessionInfo())?.user ?? undefined }),
	});

	// Prefill empty create fields with the signed-in account when the dialog opens or the account loads.
	const accountUserId = account.data?.user?.id;
	const accountUserName = account.data?.user?.name;
	const [prefilledFor, setPrefilledFor] = useState({ accountUserId, accountUserName, createOpen });
	if (prefilledFor.accountUserId !== accountUserId || prefilledFor.accountUserName !== accountUserName || prefilledFor.createOpen !== createOpen) {
		setPrefilledFor({ accountUserId, accountUserName, createOpen });
		if (createOpen) {
			setDisplayName(displayName || accountUserName?.trim() || "");
			setOwnerUserId(ownerUserId || accountUserId || "");
		}
	}

	const accounts = useQuery({
		queryKey: ["accounts", "mailbox-owners"],
		queryFn: async () => {
			const res = await authFetch("/api/accounts");
			if (!res.ok) return { accounts: [] as MailboxOwner[] };
			return (await res.json()) as { accounts: MailboxOwner[] };
		},
		enabled: createOpen,
	});

	const domains = useQuery({
		queryKey: ["domains"],
		queryFn: async () => {
			const res = await authFetch("/api/domains");
			return (await res.json()) as { domains: Domain[] };
		},
	});

	const mailboxes = useQuery({
		queryKey: ["mailboxes"],
		queryFn: async () => {
			const res = await authFetch("/api/mailboxes");
			return (await res.json()) as MailboxesResponse;
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/mailboxes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domainId,
					...(mailboxType === "personal" ? { ownerUserId } : {}),
					localPart,
					displayName: displayName.trim(),
					type: mailboxType,
				}),
			});
			const json = (await res.json()) as { id?: string; error?: string };
			if (!res.ok) throw new Error(json.error ?? t("mailboxes.failed"));
			setDisplayName("");
			setLocalPart("");
			setDomainId("");
			setOwnerUserId("");
			return json.id;
		},
		onSuccess: (mailboxId) => {
			clearMailboxesCache();
			setCreateOpen(false);
			qc.invalidateQueries({ queryKey: ["mailboxes"] });
			if (mailboxType === "shared" && mailboxId) router.push(`${base}/${mailboxId}`);
			setMailboxType("personal");
		},
	});

	const domainMap = new Map(
		(domains.data?.domains ?? []).map((d) => [d.id, d.hostname]),
	);
	const mailboxOwners = [...(accounts.data?.accounts ?? [])];
	if (account.data?.user?.id && !mailboxOwners.some((owner) => owner.id === account.data?.user?.id)) {
		mailboxOwners.unshift({
			id: account.data.user.id,
			email: account.data.user.email ?? "",
			name: account.data.user.name ?? account.data.user.email ?? t("mailboxes.currentAccount"),
			role: "admin",
		});
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">{t("mailboxes.title")}</h1>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button className={mobilePrimaryActionClass}>
							<Plus className="h-4 w-4" />
							{t("mailboxes.new")}
						</Button>
					</DialogTrigger>
					<DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>{t("mailboxes.createTitle")}</DialogTitle>
							<DialogDescription>{t("mailboxes.createDescription")}</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							{mailboxes.data?.canCreateShared && (
								<div className="space-y-2">
									<Label htmlFor="mailbox-type">{t("mailboxes.type")}</Label>
									<Select
										id="mailbox-type"
										value={mailboxType}
										onChange={(event) => setMailboxType(event.target.value as "personal" | "shared")}
										containerClassName="flex w-full px-0"
										className="h-10 px-3 text-sm"
									>
										<option value="personal">{t("mailboxes.personalInbox")}</option>
										<option value="shared">{t("mailboxes.sharedInbox")}</option>
									</Select>
								</div>
							)}
							{mailboxType === "personal" ? (
							<div className="space-y-2">
								<Label htmlFor="mailbox-owner">{t("mailboxes.account")}</Label>
								<Select
									id="mailbox-owner"
									value={ownerUserId}
									onChange={(event) => {
										const owner = mailboxOwners.find((item) => item.id === event.target.value);
										setOwnerUserId(event.target.value);
										if (owner) setDisplayName(owner.name);
									}}
									containerClassName="flex w-full px-0"
										className="h-10 px-3 text-sm"
								>
									{mailboxOwners.map((owner) => (
										<option key={owner.id} value={owner.id}>
											{owner.name} ({owner.email})
										</option>
									))}
								</Select>
							</div>
							) : (
								<Alert tone="info">{t("mailboxes.sharedHint")}</Alert>
							)}
							<div className="space-y-2">
								<Label htmlFor="mailbox-name">{t("common.name")}</Label>
								<Input
									id="mailbox-name"
									value={displayName}
									onChange={(event) => setDisplayName(event.target.value)}
									placeholder={t("mailboxes.namePlaceholder")}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="mailbox-username">{t("mailboxes.emailAddress")}</Label>
								<div className="flex h-10 overflow-hidden border border-line-control bg-surface transition-[border-color,box-shadow] duration-150 ease-out hover:border-fg-subtle focus-within:border-accent focus-within:shadow-[0_0_0_1px_var(--or-color-accent)]">
									<Input
										id="mailbox-username"
										value={localPart}
										onChange={(event) => setLocalPart(event.target.value)}
										placeholder={t("mailboxes.localPlaceholder")}
										className="min-w-0 flex-1 border-0 bg-transparent focus:shadow-none"
									/>
									<span className="flex items-center text-sm text-fg-subtle">@</span>
									<Select
										aria-label={t("accounts.domain")}
										containerClassName="max-w-[55%] border-0 bg-transparent p-0"
						className="h-full px-3 text-sm text-fg-muted"
										value={domainId}
										onChange={(event) => setDomainId(event.target.value)}
									>
										<option value="">{t("accounts.selectDomain")}</option>
										{(domains.data?.domains ?? []).map((domain) => (
											<option key={domain.id} value={domain.id}>
												{domain.hostname}
											</option>
										))}
									</Select>
								</div>
							</div>
							{create.isError && (
								<p role="alert" className="text-sm text-danger-text">{(create.error as Error).message}</p>
							)}
							<Button
								onClick={() => create.mutate()}
								disabled={(mailboxType === "personal" && !ownerUserId) || !displayName.trim() || !domainId || !localPart || create.isPending}
							>
								{create.isPending ? t("accounts.creating") : t("mailboxes.createButton")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
			<section className="space-y-3">
				{/* <div className="flex items-center justify-between">
					<span className="text-sm text-fg-subtle">
						{(mailboxes.data?.mailboxes ?? []).length} total
					</span>
				</div> */}
				{mailboxes.isLoading && (
					<SectionRowSkeleton />
				)}
				{!mailboxes.isLoading && (mailboxes.data?.mailboxes ?? []).length === 0 && (
					<EmptyState
						variant="compact"
						headingLevel={2}
						icon={<Mail className="h-5 w-5" />}
						title={t("mailboxes.none")}
						className="border border-line bg-surface px-5 py-4"
					/>
				)}
				<List>
					<div className={`${COLUMNS} bg-canvas-subtle px-5 py-3 font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle`}>
						<span className="w-10" />
						<span>{t("common.name")}</span>
						<span className="hidden md:block">{t("mailboxes.type")}</span>
						<span className="hidden md:block">{t("accounts.colStatus")}</span>
						<span className="hidden md:block">{t("accounts.colLastSignIn")}</span>
					</div>
					{(mailboxes.data?.mailboxes ?? []).map((mailbox) => {
						const mailboxWithHostname = {
							...mailbox,
							hostname: mailbox.hostname ?? domainMap.get(mailbox.domainId) ?? "?",
						};

						return (
							<ListRow key={mailbox.id} asChild className={`${COLUMNS} px-5 py-4`}>
								<Link
									href={`${base}/${mailbox.id}`}
									className="group transition-colors hover:bg-surface-hover"
								>
									<span style={getAvatarColorStyle(getMailboxAddress(mailboxWithHostname))} className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold">
										{getMailboxName(mailboxWithHostname).trim().charAt(0).toUpperCase() || "?"}
										{mailbox.hasAvatar && (
											<ProgressiveAvatarImage
												src={`/api/mailboxes/${mailbox.id}/avatar`}
												alt={t("mailboxes.profileAlt", { name: getMailboxName(mailboxWithHostname) })}
												className="absolute inset-0 h-full w-full object-cover"
											/>
										)}
									</span>
									<span className="min-w-0">
										<span className="flex min-w-0 items-center gap-2">
											<span className="block truncate text-sm font-semibold text-fg">
												{getMailboxName(mailboxWithHostname)}
											</span>
										</span>
										<span className="block truncate no-font-mono text-sm text-fg-subtle">
											{getMailboxAddress(mailboxWithHostname)}
										</span>
									</span>
									<span className="hidden md:block">
										<Tag size="sm" variant="solid" marker={false} tone={mailbox.type === "shared" ? "info" : "neutral"}>
											{mailbox.type === "shared" ? t("mailboxes.sharedInbox") : t("mailboxes.personalInbox")}
										</Tag>
									</span>
									<span className="hidden md:block">
										<Tag size="sm" tone={STATUS_TONES[mailbox.status ?? "active"]}>
											{t(`accounts.status.${mailbox.status ?? "active"}`, { date: "" })}
										</Tag>
									</span>
									<span className="hidden text-sm text-fg-subtle md:block">
										{mailbox.type === "shared" ? "—" : mailbox.lastSignInAt ? formatAccountDateTime(mailbox.lastSignInAt) : t("accounts.neverSignedIn")}
									</span>
								</Link>
							</ListRow>
						);
					})}
				</List>
			</section>
		</div>
	);
}
