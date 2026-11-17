"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import clsx from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import toast from "react-hot-toast";
import { ChevronRight, Folder, FolderPlus, HardDrive, Paperclip, Plus, Trash2, UploadCloud, UsersRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@orangesys/ui";
import { PoweredBy } from "@/components/sidebar-footer";
import { useSidebar } from "@/components/sidebar-state";
import { authFetch } from "@/lib/auth/client";
import { formatDriveSize } from "@/lib/drive/utils";
import { DRIVE_FOLDERS_EVENT, DRIVE_NEW_FOLDER_EVENT, DRIVE_REFRESH_EVENT, DRIVE_STORAGE_EVENT, DRIVE_UPLOAD_EVENT } from "./drive-events";
import type { DriveStorageDetail } from "./drive-events";
import { canDropDrive, driveDropHandlers } from "./drive-drag";
import type { DriveDropTarget } from "./drive-drag";

const itemClass = "flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover";
const FOLDERS_OPEN_KEY = "mailclaw-drive-folders-open";

type FolderNode = { id: string; name: string; parentId: string | null };

function flattenFolders(folders: FolderNode[]): (FolderNode & { depth: number })[] {
	const known = new Set(folders.map((folder) => folder.id));
	const children = new Map<string | null, FolderNode[]>();
	for (const folder of folders) {
		const key = folder.parentId && known.has(folder.parentId) ? folder.parentId : null;
		children.set(key, [...(children.get(key) ?? []), folder]);
	}
	const rows: (FolderNode & { depth: number })[] = [];
	const visit = (parent: string | null, depth: number) => {
		for (const folder of (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))) {
			rows.push({ ...folder, depth });
			visit(folder.id, depth + 1);
		}
	};
	visit(null, 0);
	return rows;
}

export function DriveNav({ onNavigate }: { onNavigate?: () => void }) {
	const { t } = useLanguage();
	const { minimal, mobile } = useSidebar();
	const pathname = usePathname();
	const params = useSearchParams();
	const view = params.get("view") ?? "my";
	const activeFolder = params.get("folder");
	const [storage, setStorage] = useState<DriveStorageDetail | null>(null);
	const [foldersOpen, setFoldersOpen] = useState(() => {
		try { return localStorage.getItem(FOLDERS_OPEN_KEY) === "1"; } catch { /* storage unavailable */ return false; }
	});
	const [folders, setFolders] = useState<FolderNode[]>([]);
	const compact = minimal && !mobile;
	const [creating, setCreating] = useState(false);
	const [folderName, setFolderName] = useState("");
	const [saving, setSaving] = useState(false);
	// The sidebar entry items are being dragged over: "my", "trash" or a folder id.
	const [dropKey, setDropKey] = useState<string | null>(null);

	useEffect(() => {
		const onStorage = (event: Event) => setStorage((event as CustomEvent<DriveStorageDetail>).detail);
		window.addEventListener(DRIVE_STORAGE_EVENT, onStorage);
		return () => window.removeEventListener(DRIVE_STORAGE_EVENT, onStorage);
	}, []);

	const loadFolders = useCallback(() => authFetch("/api/drive/folders", { redirectOnUnauthorized: false })
		.then(async (response) => { if (response.ok) setFolders((await response.json() as { folders: FolderNode[] }).folders); })
		.catch(() => { /* the list stays as it was */ }), []);

	useEffect(() => {
		if (!foldersOpen) return;
		void loadFolders();
		window.addEventListener(DRIVE_FOLDERS_EVENT, loadFolders);
		return () => window.removeEventListener(DRIVE_FOLDERS_EVENT, loadFolders);
	}, [foldersOpen, loadFolders]);

	function toggleFolders() {
		setFoldersOpen((open) => {
			try { localStorage.setItem(FOLDERS_OPEN_KEY, open ? "0" : "1"); } catch { /* ignore */ }
			return !open;
		});
	}

	async function createFolder(event: React.FormEvent) {
		event.preventDefault();
		const name = folderName.trim();
		if (!name || saving) return;
		setSaving(true);
		try {
			const response = await authFetch("/api/drive/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
			const data = await response.json().catch(() => ({})) as { error?: string };
			if (!response.ok) throw new Error(data.error);
			toast.success(t("drive.folderCreated"));
			setCreating(false);
			setFolderName("");
			if (!foldersOpen) toggleFolders();
			void loadFolders();
			window.dispatchEvent(new Event(DRIVE_REFRESH_EVENT));
		} catch (error) {
			toast.error(error instanceof Error && error.message ? error.message : t("drive.actionFailed"));
		} finally { setSaving(false); }
	}

	const rows = useMemo(() => flattenFolders(folders), [folders]);
	const parents = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.parentId])), [folders]);
	// True when `folderId` is one of `ancestorIds` or sits somewhere beneath one of them.
	const isInside = useCallback((folderId: string, ancestorIds: Set<string>) => {
		for (let current: string | null | undefined = folderId, steps = 0; current && steps < 1000; current = parents.get(current), steps += 1) {
			if (ancestorIds.has(current)) return true;
		}
		return false;
	}, [parents]);
	const dropProps = (key: string, target: DriveDropTarget) => driveDropHandlers(target, () => canDropDrive(target, isInside), t, (over) => setDropKey((current) => (over ? key : current === key ? null : current)));
	const dropHighlight = "bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent-border";
	const links = [
		{ key: "my", href: "/drive", label: t("drive.myDrive"), icon: HardDrive },
		{ key: "attachments", href: "/drive?view=attachments", label: t("drive.attachments"), icon: Paperclip },
		{ key: "shared", href: "/drive?view=shared", label: t("drive.sharedWithMe"), icon: UsersRound },
		{ key: "trash", href: "/drive?view=trash", label: t("drive.trash"), icon: Trash2 },
	];
	const percent = storage?.limit ? Math.min(100, Math.round((storage.used / storage.limit) * 100)) : 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger asChild>
						<button type="button" aria-label={t("drive.new")} className={clsx("mb-4 flex h-12 items-center gap-3 bg-accent font-display text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover", compact ? "w-12 justify-center" : "w-fit px-5")}>
							<Plus size={22} />{!compact && t("drive.new")}
						</button>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content align="start" sideOffset={6} className="z-[200] min-w-52 border border-line bg-surface-raised p-1 shadow-lg">
							<DropdownMenu.Item className={itemClass} onSelect={() => { window.dispatchEvent(new Event(DRIVE_NEW_FOLDER_EVENT)); onNavigate?.(); }}><FolderPlus size={18} />{t("drive.newFolder")}</DropdownMenu.Item>
							<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
							<DropdownMenu.Item className={itemClass} onSelect={() => { window.dispatchEvent(new Event(DRIVE_UPLOAD_EVENT)); onNavigate?.(); }}><UploadCloud size={18} />{t("drive.fileUpload")}</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
				<nav aria-label={t("drive.sections")} className="space-y-px">
					{links.map(({ key, href, label, icon: Icon }) => {
						const active = pathname === "/drive" && view === key && !activeFolder;
						// My Drive takes items to its root (restoring them from the trash), Trash trashes them, and
						// Attachments takes trashed attachments back.
						const target: DriveDropTarget | null = key === "my" ? { kind: "folder", id: null } : key === "trash" ? { kind: "trash" } : key === "attachments" ? { kind: "attachments" } : null;
						return (
							<Link key={key} href={href} onClick={onNavigate} {...(target ? dropProps(key, target) : {})} aria-current={active ? "page" : undefined} title={compact ? label : undefined} className={clsx("relative flex h-10 items-center gap-3 text-sm transition-colors", compact ? "w-10 justify-center" : "px-4", dropKey === key ? dropHighlight : active ? "bg-accent-subtle font-semibold text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent" : "text-fg-muted hover:bg-surface-hover hover:text-fg")}>
								<Icon size={16} />{!compact && label}
							</Link>
						);
					})}
				</nav>
				{!compact && (
					<div className="mt-3">
						<div className="flex items-center gap-1">
							<button type="button" onClick={toggleFolders} aria-expanded={foldersOpen} aria-label={t("drive.foldersToggle")} className="flex h-9 min-w-0 flex-1 items-center gap-2 px-4 text-start text-fg-subtle hover:bg-surface-hover hover:text-fg">
								<ChevronRight size={14} className={clsx("shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100", foldersOpen && "rotate-90 rtl:-rotate-90")} /><Eyebrow as="span" className="block min-w-0 truncate text-inherit">{t("drive.folders")}</Eyebrow>
							</button>
							<button type="button" onClick={() => { setFolderName(""); setCreating(true); }} aria-label={t("drive.newFolder")} title={t("drive.newFolder")} className="flex h-8 w-8 shrink-0 items-center justify-center text-fg-subtle hover:bg-surface-hover hover:text-fg"><Plus size={16} /></button>
						</div>
						{foldersOpen && (
							<ul className="mt-0.5 space-y-px">
								{rows.length === 0 && <li className="px-4 py-1.5 text-xs text-fg-subtle">{t("drive.noFolders")}</li>}
								{rows.map((folder) => (
									<li key={folder.id}>
										<Link href={`/drive?folder=${encodeURIComponent(folder.id)}`} onClick={onNavigate} {...dropProps(folder.id, { kind: "folder", id: folder.id })} aria-current={activeFolder === folder.id ? "page" : undefined} style={{ paddingInlineStart: 16 + folder.depth * 14 }} className={clsx("relative flex h-8 items-center gap-2 pe-3 text-sm transition-colors", dropKey === folder.id ? dropHighlight : activeFolder === folder.id ? "bg-accent-subtle font-semibold text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent" : "text-fg-muted hover:bg-surface-hover hover:text-fg")}>
											<Folder size={14} className="shrink-0 text-[var(--or-color-viz-3)]" /><span className="truncate">{folder.name}</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
			{!compact && (
				<div className="shrink-0 border-t border-line-subtle px-4 py-3">
					{storage && (
						storage.limit ? (
							<div className="mb-2">
								<div role="progressbar" aria-label={t("drive.storageBar")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mb-1.5 h-1 overflow-hidden bg-surface-active">
									<div className={clsx("h-full transition-[width] motion-reduce:transition-none", percent >= 90 ? "bg-danger" : "bg-accent")} style={{ width: `${percent}%` }} />
								</div>
								<p className="font-mono text-xs tabular-nums text-fg-muted">{t("drive.storageOf", { used: formatDriveSize(storage.used), total: formatDriveSize(storage.limit) })}</p>
							</div>
						) : <p className="mb-2 font-mono text-xs tabular-nums text-fg-muted">{t("drive.storageUsed", { size: formatDriveSize(storage.used) })}</p>
					)}
					<PoweredBy className="" />
				</div>
			)}
			<Dialog open={creating} onOpenChange={(open) => { if (!saving) setCreating(open); }}>
				<DialogContent>
					<DialogHeader><DialogTitle>{t("drive.newFolder")}</DialogTitle></DialogHeader>
					<form onSubmit={(event) => void createFolder(event)} className="space-y-5">
						<Input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder={t("drive.folderName")} aria-label={t("drive.folderName")} maxLength={255} />
						<div className="flex justify-end gap-2">
							<Button type="button" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>{t("common.cancel")}</Button>
							<Button type="submit" disabled={saving || !folderName.trim()}>{t("drive.create")}</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
