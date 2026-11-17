"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Columns2 } from "@/components/icons";
import clsx from "clsx";
import { useLanguage } from "@/components/language-provider";
import { Tooltip } from "@/components/ui/tooltip";
import { useMessageListVisibility } from "./message-list-visibility";
import type { MessageReadingHeaderButtonProps } from "./message-reading-header-button-types";

export function MessageReadingHeaderButton({ assistantVisible }: MessageReadingHeaderButtonProps) {
	const { t } = useLanguage();
	const router = useRouter();
	const { visible, toggle, singleColumn, backHref, backLabel } = useMessageListVisibility();
	const label = singleColumn
		? t("message.nav.backTo", { folder: backLabel })
		: assistantVisible ? null : visible ? t("message.nav.hideList") : t("message.nav.showList");

	function handleClick() {
		if (singleColumn) router.push(backHref);
		else toggle();
	}

	return (
		<Tooltip label={label} className={singleColumn ? "inline-flex" : "hidden lg:inline-flex"}>
			<button
				type="button"
				className={clsx(!singleColumn && assistantVisible ? "opacity-40" : !singleColumn && !visible ? "opacity-60 hover:opacity-100" : "", (singleColumn || !assistantVisible) && "hover:bg-surface-hover hover:text-fg", "relative z-10 shrink-0 p-2 text-fg-muted duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus")}
				onClick={handleClick}
				disabled={!singleColumn && assistantVisible}
				aria-label={label ?? t("message.nav.listUnavailable")}
				aria-pressed={singleColumn ? undefined : visible}
			>
				{singleColumn ? <ArrowLeft size={16} /> : <Columns2 size={16} />}
			</button>
		</Tooltip>
	);
}
