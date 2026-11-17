"use client";

import type { HTMLAttributes } from "react";
import { ChevronUp, Forward, Maximize2, Minimize2, Minus, Reply, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { ComposeFormMode, ComposeTitleKey } from "./compose-form-types";

/** The dark bar on top of the composer: what is being written, and the popup's window buttons. */
export function ComposeTitleBar({
	mode,
	titleKey,
	isReply,
	isForward,
	saveFailed,
	minimized,
	modalMode,
	onToggleMinimized,
	onToggleModal,
	onClose,
	dragHandlers,
}: {
	mode: ComposeFormMode;
	titleKey: ComposeTitleKey;
	isReply: boolean;
	isForward: boolean;
	/** The latest autosave failed. */
	saveFailed: boolean;
	minimized: boolean;
	modalMode: boolean;
	onToggleMinimized: () => void;
	onToggleModal: () => void;
	onClose: () => void;
	/** Touch handlers that let a phone bottom sheet be dragged down. */
	dragHandlers: HTMLAttributes<HTMLDivElement>;
}) {
	const { t } = useLanguage();
	return (
		<div {...dragHandlers} className="flex h-9 shrink-0 items-center justify-between max-md:h-12 max-md:touch-none bg-neutral-800 text-white dark:bg-neutral-100 px-4 text-sm font-medium">
			<span className="flex min-w-0 items-center gap-2 truncate  dark:text-neutral-900">
				{isReply && <Reply className="h-3.5 w-3.5 text-neutral-300" />}
				{!isReply && isForward && <Forward className="h-3.5 w-3.5 text-neutral-300" />}
				{t(titleKey)}
				{saveFailed && titleKey !== "compose.title.loading" && (
					<span className="shrink-0 text-xs font-normal text-red-300" title={t("compose.error.autosave")}>
						· {t("compose.notSaved")}
					</span>
				)}
			</span>
			{mode === "popup" && (
				<div className="flex shrink-0 items-center gap-3 text-neutral-300">
					<button type="button" onClick={onToggleMinimized} aria-label={minimized ? t("compose.restore") : t("compose.minimize")} title={minimized ? t("compose.restore") : t("compose.minimize")} className="max-md:hidden rounded p-1 hover:bg-neutral-700 dark:hover:bg-neutral-200 hover:text-white">
						{minimized ? <ChevronUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
					</button>
					<button type="button" onClick={onToggleModal} aria-label={modalMode ? t("compose.restoreFloating") : t("compose.openModal")} title={modalMode ? t("compose.restoreFloating") : t("compose.openModal")} className="max-md:hidden rounded p-1 dark:hover:bg-neutral-200 hover:bg-neutral-700 hover:text-white">
						{modalMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
					</button>
					<button type="button" onClick={onClose} aria-label={t("compose.close")} className="rounded p-1 max-md:-m-2 max-md:p-3 hover:bg-neutral-700 dark:hover:bg-neutral-200 hover:text-white">
						<X className="h-4 w-4" />
					</button>
				</div>
			)}
		</div>
	);
}
