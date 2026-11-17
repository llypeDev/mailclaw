"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Alert } from "@orangesys/ui";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { ProgressiveAvatarImage } from "@/components/progressive-avatar-image";
import { getAvatarColorStyle } from "@/lib/avatar-colors";
import { useCurrentUser, clearCurrentUserCache } from "@/hooks/use-current-user";
import type { ManagedAccount } from "../types";
import {
	fetchManagedAccount,
	fetchTransferCandidates,
	saveManagedAccount,
	transferPrimaryAdmin,
	type TransferCandidate,
} from "../utils";

export default function AccountPermissionsPage() {
	const { t } = useLanguage();
	const { id } = useParams<{ id: string }>();
	const currentUser = useCurrentUser();
	const [account, setAccount] = useState<ManagedAccount | null>(null);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [candidates, setCandidates] = useState<TransferCandidate[]>([]);
	const [transferTargetId, setTransferTargetId] = useState("");
	const [transferOpen, setTransferOpen] = useState(false);
	const [transferring, setTransferring] = useState(false);

	useEffect(() => {
		void fetchManagedAccount(id)
			.then(setAccount)
			.catch((error) => setMessage(error instanceof Error ? error.message : t("account.permissions.loadFailed")));
	}, [id, t]);

	const isPrimary = !!account?.canChangeRole;
	const transferTarget = useMemo(
		() => candidates.find((candidate) => candidate.id === transferTargetId) ?? null,
		[candidates, transferTargetId],
	);

	useEffect(() => {
		if (!isPrimary) return;
		void fetchTransferCandidates()
			.then((list) => setCandidates(list.filter((candidate) => candidate.id !== currentUser?.id && !candidate.disabled)))
			.catch(() => undefined);
	}, [isPrimary, currentUser?.id]);

	async function savePermissions() {
		if (!account) return;
		setSaving(true);
		setMessage(null);
		try {
			await saveManagedAccount(account);
			// Editing your own flags changes what your navigation shows; drop the cached user.
			if (currentUser?.id === account.id) clearCurrentUserCache();
			setMessage(t("account.permissions.updated"));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("account.permissions.updateFailed"));
		} finally {
			setSaving(false);
		}
	}

	async function confirmTransfer() {
		if (!transferTarget) return;
		setTransferring(true);
		setMessage(null);
		try {
			await transferPrimaryAdmin(transferTarget.id);
			clearCurrentUserCache();
			setTransferOpen(false);
			// A full reload drops the stale cached session so the navigation reflects the new role.
			// eslint-disable-next-line nextjs-js/no-location-assign-relative-destination -- the full reload is the point (see above)
			window.location.assign(`/accounts/${transferTarget.id}/permissions`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : t("account.permissions.transferFailed"));
			setTransferring(false);
		}
	}

	const editable = !!account?.editable;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">{t("account.permissions.title")}</h1>
				<p className="mt-2 text-sm text-fg-muted">{t("account.permissions.description")}</p>
			</div>
			{account?.isPrimaryAdmin && (
				<Alert tone="info" title={t("account.permissions.primaryAdmin")}>
					{t("account.permissions.primaryNote")}
				</Alert>
			)}
			<section className="space-y-3 border border-line bg-surface p-5">
				<label htmlFor="account-role" className="block font-display text-sm font-semibold text-fg">{t("accounts.role")}</label>
				<Select
					id="account-role"
					value={account?.role ?? "user"}
					disabled={!account || saving || !account.canChangeRole}
					containerClassName="w-full sm:w-64"
					className="h-10 text-sm"
					onChange={(event) => account && setAccount({ ...account, role: event.target.value === "admin" ? "admin" : "user" })}
				>
					<option value="user">{t("accounts.roleUser")}</option>
					<option value="admin">{t("accounts.roleAdmin")}</option>
				</Select>
				<p className="text-xs text-fg-subtle">
					{account?.canChangeRole
						? t("account.permissions.admins")
						: t("account.permissions.onlyPrimaryRoles")}
				</p>
			</section>
			<div className="overflow-hidden border border-line bg-surface">
				<table className="w-full text-start">
					<thead className="border-b border-line-strong bg-canvas-subtle font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">
						<tr>
							<th scope="col" className="px-5 py-3 text-start font-medium">{t("account.permissions.permission")}</th>
							<th scope="col" className="w-28 px-5 py-3 text-center font-medium">{t("account.permissions.allowed")}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-line">
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-fg">{t("account.permissions.manageMailboxes")}</p>
								<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.manageMailboxesHint")}</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label={t("account.permissions.allowMailboxes")}
									checked={account?.canManageMailboxes ?? false}
									disabled={!account || !editable}
									onChange={(event) => account && setAccount({ ...account, canManageMailboxes: event.target.checked })}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-fg">{t("account.permissions.manageDomains")}</p>
								<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.manageDomainsHint")}</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label={t("account.permissions.allowDomains")}
									checked={account?.canManageDomains ?? false}
									disabled={!account || !account.canChangeRole}
									onChange={(event) => account && setAccount({ ...account, canManageDomains: event.target.checked })}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-fg">{t("account.permissions.manageUsers")}</p>
								<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.manageUsersHint")}</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label={t("account.permissions.allowUsers")}
									checked={account?.canManageUsers ?? false}
									disabled={!account || !account.canChangeRole}
									onChange={(event) => account && setAccount({ ...account, canManageUsers: event.target.checked })}
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<section className="overflow-hidden border border-line bg-surface">
				<div className="border-b border-line-strong bg-canvas-subtle px-5 py-3">
					<h2 className="font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">{t("account.permissions.features")}</h2>
					<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.featuresHint")}</p>
				</div>
				<table className="w-full text-start">
					<tbody className="divide-y divide-line">
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-fg">{t("account.calendar")}</p>
								<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.calendarHint")}</p>
							</td>
							<td className="w-28 px-5 py-4 text-center">
								<Checkbox
									aria-label={t("account.permissions.allowCalendar")}
									checked={account?.calendarEnabled ?? true}
									disabled={!account || !editable}
									onChange={(event) => account && setAccount({ ...account, calendarEnabled: event.target.checked })}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-fg">{t("account.drive")}</p>
								<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.driveHint")}</p>
							</td>
							<td className="w-28 px-5 py-4 text-center">
								<Checkbox
									aria-label={t("account.permissions.allowDrive")}
									checked={account?.driveEnabled ?? true}
									disabled={!account || !editable}
									onChange={(event) => account && setAccount({ ...account, driveEnabled: event.target.checked })}
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</section>
			{editable && (
				<Button onClick={() => void savePermissions()} disabled={saving}>
					{saving ? t("common.saving") : t("account.permissions.save")}
				</Button>
			)}
			{isPrimary && (
				<section className="space-y-4 border border-line bg-surface p-5">
					<div>
						<h2 className="font-display text-sm font-semibold text-fg">{t("account.permissions.transferTitle")}</h2>
						<p className="mt-1 text-xs text-fg-subtle">{t("account.permissions.transferHint")}</p>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row">
						<Select
							aria-label={t("account.permissions.selectNext")}
							value={transferTargetId}
							containerClassName="w-full sm:max-w-sm"
							className="h-10 text-sm"
							onChange={(event) => setTransferTargetId(event.target.value)}
						>
							<option value="">{t("account.permissions.selectAccount")}</option>
							{candidates.map((candidate) => (
								<option key={candidate.id} value={candidate.id}>{candidate.email} — {candidate.name}</option>
							))}
						</Select>
						<Button variant="outline" disabled={!transferTarget} onClick={() => setTransferOpen(true)}>
							{t("account.permissions.transferTitle")}
						</Button>
					</div>
				</section>
			)}
			{message && <p role="status" className="text-sm text-fg-muted">{message}</p>}

			<Dialog open={transferOpen} onOpenChange={setTransferOpen}>
				<DialogContent className="w-[min(420px,calc(100vw-32px))]">
					<DialogHeader>
						<DialogTitle>{t("account.permissions.transferQuestion")}</DialogTitle>
						<DialogDescription>
							{t("account.permissions.transferWarning")}
						</DialogDescription>
					</DialogHeader>
					{transferTarget && (
						<div className="flex items-center gap-4 border border-line p-4">
							<span
								className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold"
								style={getAvatarColorStyle(transferTarget.email)}
							>
								{transferTarget.name.charAt(0).toUpperCase()}
								{transferTarget.hasAvatar && (
									<ProgressiveAvatarImage
										src={`/api/accounts/${transferTarget.id}/avatar`}
										alt=""
										className="absolute inset-0 h-full w-full object-cover"
									/>
								)}
							</span>
							<span className="min-w-0">
								<span className="block truncate font-semibold text-fg">{transferTarget.name}</span>
								<span className="block truncate text-sm text-fg-subtle">{transferTarget.email}</span>
							</span>
						</div>
					)}
					<div className="flex justify-end gap-2">
						<DialogClose asChild>
							<Button variant="outline" disabled={transferring}>{t("common.cancel")}</Button>
						</DialogClose>
						<Button disabled={transferring || !transferTarget} onClick={() => void confirmTransfer()}>
							{transferring ? t("account.permissions.transferring") : t("account.permissions.confirmTransfer")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
