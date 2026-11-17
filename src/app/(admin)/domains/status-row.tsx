import type { ReactNode } from "react";
import { AlertTriangle, Check } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { STATUS_ROW_TONE, STATUS_TILE_TONE, type StatusTone } from "./utils";

// A status line drawn like Orange's contextual message: a 1px frame on the surface whose 3px start edge
// carries the tone (STATUS_ROW_TONE), the fill staying neutral; the icon tile repeats the tone.
export const ROW_GRID = "grid gap-3 border border-line border-s-[3px] bg-surface px-4 py-3 text-sm text-fg sm:grid-cols-[auto_minmax(8rem,14rem)_minmax(0,1fr)_auto] sm:items-start";

/** A square icon tile: a check when set up, a warning sign otherwise, with the state as text for screen readers. */
export function StatusBadge({ ok, tone = "red" }: { ok: boolean; tone?: "red" | "neutral" | "warning" }) {
	const { t } = useLanguage();
	const look: StatusTone = ok ? "success" : tone === "red" ? "danger" : tone;
	return (
		<span className={cn("flex h-7 w-7 shrink-0 items-center justify-center", STATUS_TILE_TONE[look])}>
			{ok ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
			<span className="sr-only">{ok ? t("domains.setUp") : t("domains.needsSetup")}</span>
		</span>
	);
}

/** An icon-left status line shared by the domain setup and sending setup lists. */
export function StatusRow({ ok, title, hint, children, action }: { ok: boolean; title: string; hint: string; children?: ReactNode; action?: ReactNode }) {
	return (
		<li className={cn(ROW_GRID, ok ? STATUS_ROW_TONE.success : STATUS_ROW_TONE.danger)}>
			<StatusBadge ok={ok} />
			<span className="min-w-0">
				<span className="block font-display font-medium text-fg">{title}</span>
				{hint && <span className="block text-xs text-fg-muted">{hint}</span>}
			</span>
			<span className="min-w-0 break-words text-fg-muted">{children}</span>
			{action && <span className="flex flex-wrap items-center gap-2">{action}</span>}
		</li>
	);
}
