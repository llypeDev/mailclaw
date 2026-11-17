"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { FOLLOW_UP_DAY_OPTIONS } from "@/lib/follow-ups/follow-up-utils";
import { followUpOptionKey } from "./follow-up-client-utils";

const ITEM_CLASS = "flex cursor-pointer items-center px-3 py-2 outline-none hover:bg-surface-hover focus:bg-surface-hover";

/**
 * Picks how many days without a reply before a reminder. `trigger` must be a
 * single focusable element; `onClear` adds a "no reminder" entry.
 */
export function FollowUpMenu({ trigger, onPick, onClear, disabled }: {
	trigger: ReactNode;
	onPick: (days: number) => void;
	onClear?: () => void;
	disabled?: boolean;
}) {
	const { t } = useLanguage();
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild disabled={disabled}>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content align="start" sideOffset={6} collisionPadding={8} className="z-50 min-w-56 border border-line bg-surface-raised p-1 text-sm text-fg shadow-lg">
					<DropdownMenu.Label className="px-3 pb-1 pt-2 font-display text-xs font-medium uppercase tracking-wider text-fg-subtle">{t("followUp.remindMe")}</DropdownMenu.Label>
					{FOLLOW_UP_DAY_OPTIONS.map((days) => (
						<DropdownMenu.Item key={days} onSelect={() => onPick(days)} className={ITEM_CLASS}>
							{t(followUpOptionKey(days))}
						</DropdownMenu.Item>
					))}
					{onClear && (
						<>
							<DropdownMenu.Separator className="my-1 h-px bg-line-subtle" />
							<DropdownMenu.Item onSelect={onClear} className={ITEM_CLASS}>
								<X className="me-2 h-4 w-4" />
								{t("followUp.none")}
							</DropdownMenu.Item>
						</>
					)}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
