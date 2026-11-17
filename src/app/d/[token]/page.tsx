"use client";

import { use, useEffect, useState } from "react";
import { EmptyState } from "@orangesys/ui";
import { ChevronRight, Download, Folder } from "@/components/icons";
import { buttonVariants } from "@/components/ui/button-utils";
import { useLanguage } from "@/components/language-provider";
import { formatDriveSize } from "@/lib/drive/utils";
import { DrivePreviewBody } from "@/app/(drive)/drive-preview";
import { driveIconFor, publicContentUrl, sortDriveItems } from "@/app/(drive)/drive-utils";
import type { PublicDriveItem, PublicDriveListing } from "./types";

export default function PublicDrivePage({ params }: { params: Promise<{ token: string }> }) {
	const { token } = use(params);
	const { t } = useLanguage();
	const [itemId, setItemId] = useState<string | null>(null);
	const [data, setData] = useState<PublicDriveListing | null>(null);
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let active = true;
		const search = itemId ? `?item=${encodeURIComponent(itemId)}` : "";
		void fetch(`/api/drive/public/${encodeURIComponent(token)}${search}`)
			.then(async (response) => {
				if (!response.ok) throw new Error();
				return response.json() as Promise<PublicDriveListing>;
			})
			.then((listing) => { if (active) { setData(listing); setMissing(false); } })
			.catch(() => { if (active) setMissing(true); });
		return () => { active = false; };
	}, [token, itemId]);

	if (missing) return <main className="flex min-h-dvh items-center justify-center bg-canvas p-6 text-center text-fg-muted">{t("drive.publicNotFound")}</main>;
	if (!data) return <main className="min-h-dvh bg-canvas" aria-busy="true" />;
	const { item, items, path } = data;
	const isFile = item.kind === "file";

	return (
		<main className="mx-auto flex min-h-dvh max-w-5xl flex-col bg-canvas p-4 text-fg md:p-8">
			<nav className="mb-4 flex flex-wrap items-center gap-1 font-display text-lg text-fg">
				{path.map((crumb, index) => (
					<span key={crumb.id} className="flex items-center gap-1">
						{index > 0 && <ChevronRight size={18} className="text-fg-subtle rtl:-scale-x-100" />}
						{index === path.length - 1 ? <h1 className="px-2 py-1 font-semibold tracking-[-0.01em]">{crumb.name}</h1> : <button type="button" onClick={() => setItemId(crumb.id)} className="px-2 py-1 text-fg-muted hover:bg-surface-hover hover:text-fg">{crumb.name}</button>}
					</span>
				))}
				{isFile && <a href={publicContentUrl(token, item.id, true)} className={`${buttonVariants()} ms-auto gap-2 font-sans`}><Download size={16} />{t("drive.download")}</a>}
			</nav>
			{isFile ? (
				<div className="min-h-[70vh] flex-1 border border-line bg-canvas-subtle p-3"><DrivePreviewBody src={publicContentUrl(token, item.id)} downloadHref={publicContentUrl(token, item.id, true)} contentType={item.contentType} name={item.name} /></div>
			) : (
				<div className="divide-y divide-line-subtle border border-line bg-surface">
					{items.length === 0 ? <EmptyState animated={false} headingLevel={2} icon={<Folder className="h-6 w-6" aria-hidden="true" />} title={t("drive.empty")} /> : sortDriveItems(items, "name", true).map((entry) => <PublicRow key={entry.id} entry={entry} token={token} onOpen={setItemId} />)}
				</div>
			)}
		</main>
	);
}

function PublicRow({ entry, token, onOpen }: { entry: PublicDriveItem; token: string; onOpen: (id: string) => void }) {
	const { Icon, className } = driveIconFor(entry);
	return (
		<div className="flex items-center gap-4 px-4 text-sm hover:bg-surface-hover">
			<button type="button" onClick={() => onOpen(entry.id)} className="flex min-w-0 flex-1 items-center gap-4 py-3 text-start">
				<Icon size={16} className={className} fill={entry.kind === "folder" ? "currentColor" : "none"} />
				<span className="truncate text-fg">{entry.name}</span>
			</button>
			{entry.kind === "file" && <span className="hidden shrink-0 font-mono text-xs tabular-nums text-fg-subtle sm:block">{formatDriveSize(entry.size)}</span>}
			{entry.kind === "file" && <a href={publicContentUrl(token, entry.id, true)} aria-label={entry.name} className="shrink-0 p-2 text-fg-muted hover:bg-surface-active hover:text-fg"><Download size={16} /></a>}
		</div>
	);
}
