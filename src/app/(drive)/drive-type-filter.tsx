"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { Check, ListFilter } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { DRIVE_CATEGORIES } from "@/lib/drive/category-names";
import type { DriveCategory } from "@/lib/drive/category-names";

/** Multi-select filter by kind of file (photos, videos, documents, others). */
export function DriveTypeFilter({ value: applied, onChange }: { value: DriveCategory[]; onChange: (next: DriveCategory[]) => void }) {
	const { t } = useLanguage();
	// Local copy so quick successive clicks build on each other while the URL update is still in flight.
	const [value, setValue] = useState(applied);
	const appliedKey = applied.join(",");
	const [syncedKey, setSyncedKey] = useState(appliedKey);
	if (syncedKey !== appliedKey) {
		setSyncedKey(appliedKey);
		setValue(appliedKey ? (appliedKey.split(",") as DriveCategory[]) : []);
	}
	const update = (next: DriveCategory[]) => { setValue(next); onChange(next); };
	const labels: Record<DriveCategory, string> = { photos: t("drive.photos"), videos: t("drive.videos"), documents: t("drive.documents"), others: t("drive.others") };
	const active = value.length > 0;
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>
				<button type="button" aria-label={t("drive.typeFilter")} className={clsx("flex h-9 shrink-0 items-center gap-2 border px-3 text-sm", active ? "border-accent-border bg-accent-subtle text-accent-text" : "border-line text-fg-muted hover:bg-surface-hover hover:text-fg")}>
					<ListFilter size={16} />{t("drive.typeFilter")}{active && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs tabular-nums text-on-accent">{value.length}</span>}
				</button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="end" sideOffset={6} className="z-[200] min-w-48 border border-line bg-surface-raised p-1 shadow-lg">
					{DRIVE_CATEGORIES.map((category) => (
						<DropdownMenu.CheckboxItem
							key={category}
							checked={value.includes(category)}
							onCheckedChange={(checked) => update(checked ? [...value, category] : value.filter((entry) => entry !== category))}
							onSelect={(event) => event.preventDefault()}
							className="relative flex cursor-pointer items-center py-2 pe-3 ps-8 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover"
						>
							<DropdownMenu.ItemIndicator className="absolute start-2.5"><Check size={14} className="text-accent-text" /></DropdownMenu.ItemIndicator>
							{labels[category]}
						</DropdownMenu.CheckboxItem>
					))}
					{active && (
						<>
							<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
							<DropdownMenu.Item onSelect={() => update([])} className="cursor-pointer px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover">{t("drive.clearFilter")}</DropdownMenu.Item>
						</>
					)}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
