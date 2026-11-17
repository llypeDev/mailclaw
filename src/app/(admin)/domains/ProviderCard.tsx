import type { ReactNode } from "react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "./status-row";

type Props = {
	title: string;
	description: string;
	/** true = set up, false = needs setup, null = unknown or not applicable (no icon). */
	ok: boolean | null;
	selected: boolean;
	disabled?: boolean;
	onToggle: (on: boolean) => void;
	/** Configuration shown while the option is selected. */
	children?: ReactNode;
	/** Shown on an unselected option that still has configuration. */
	cleanup?: { present: boolean; busy: boolean; disabled?: boolean; onClick: () => void } | null;
};

/** One selectable provider: icon-left header with a switch, its config when on, a clean-up bar when off but configured. */
export default function ProviderCard({ title, description, ok, selected, disabled, onToggle, children, cleanup }: Props) {
	const { t } = useLanguage();
	return (
		<li className="border border-line bg-canvas-subtle px-4 py-3 text-sm">
			<div className="flex items-center justify-between gap-3">
				{ok !== null && (
					<span title={ok ? t("domains.setUp") : t("domains.needsSetup")} className="shrink-0">
						<StatusBadge ok={ok} tone="warning" />
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className="block font-display font-medium text-fg">{title}</span>
					<span className="block text-xs text-fg-muted">{description}</span>
				</span>
				<Switch aria-label={title} checked={selected} disabled={disabled} onCheckedChange={onToggle} />
			</div>
			{selected && children && <div className="mt-3 border-t border-line pt-3">{children}</div>}
			{!selected && cleanup?.present && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-fg-muted">
					<span>{t("domains.stillSetUp", { title })}</span>
					<Button size="sm" variant="outline" disabled={cleanup.busy || cleanup.disabled} onClick={cleanup.onClick}>
						{cleanup.busy ? t("domains.removing") : t("domains.cleanUp")}
					</Button>
				</div>
			)}
		</li>
	);
}
