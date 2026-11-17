"use client";

import { useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Eyebrow } from "@orangesys/ui";
import { ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { readStorage, writeStorage } from "./reorderable-list-utils";

const subscribeNothing = () => () => {};
const hydratedOnClient = () => true;
const hydratedOnServer = () => false;

/** Open/closed state of a menu section, remembered in localStorage. Starts open. */
export function useSectionOpen(storageKey: string): [boolean, () => void] {
	// Storage is read after hydration so the server and first client render agree.
	const hydrated = useSyncExternalStore(subscribeNothing, hydratedOnClient, hydratedOnServer);
	const [toggled, setToggled] = useState<{ key: string; open: boolean } | null>(null);
	const open = toggled?.key === storageKey ? toggled.open : hydrated ? readStorage(storageKey, true) : true;
	function toggle() {
		writeStorage(storageKey, !open);
		setToggled({ key: storageKey, open: !open });
	}
	return [open, toggle];
}

/** Collapsible section label: an Orange eyebrow behind a chevron that turns when the section opens. */
export function NavSectionHeader({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
	return (
		<div className="mt-2 flex h-9 shrink-0 items-center justify-between gap-1 ms-3 me-2 pe-2 hover:bg-surface-hover">
			<button type="button" onClick={onToggle} aria-expanded={open} className="flex h-9 min-w-0 flex-1 items-center gap-2 ps-3 pe-3 text-start text-fg-subtle hover:text-fg">
				<ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100", open && "rotate-90 rtl:-rotate-90")} />
				<Eyebrow as="span" className="block min-w-0 truncate text-inherit max-md:text-xs">{label}</Eyebrow>
			</button>
			{children}
		</div>
	);
}
