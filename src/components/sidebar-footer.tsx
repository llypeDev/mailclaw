"use client";

import { Kbd } from "@orangesys/ui";
import packageJson from "../../package.json";
import { useSidebar } from "./sidebar-state";
import { useShortcuts } from "./shortcuts";
import { Keyboard } from "@/components/icons";
import { useLanguage } from "./language-provider";

export function SidebarFooter() {
	const { t } = useLanguage();
	const { minimal } = useSidebar();
	const { openHelpModal, shortcutsEnabled, shortcutsPreferenceLoading } = useShortcuts();
	if (minimal) return null;

  return (
    <div className="px-3 pt-3 flex flex-col gap-2">
      {shortcutsEnabled && !shortcutsPreferenceLoading && (
        <button
          type="button"
          onClick={openHelpModal}
          className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs text-fg-subtle hover:text-fg hover:bg-surface-hover transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Keyboard className="w-3.5 h-3.5" />
            {t("navigation.shortcuts")}
          </span>
          <Kbd size="sm">?</Kbd>
        </button>
      )}
      <PoweredBy />
    </div>
  );
}

/** The "Powered by Mailclaw vX" credit, shared by the mail and Drive sidebars. */
export function PoweredBy({ className = "px-1" }: { className?: string }) {
	const { t } = useLanguage();
	return (
      <p className={`${className} font-mono text-[11px] text-fg-subtle`}>
        {t("navigation.poweredBy")}{" "}
        <a
          href={`https://mailclaw.co/?ref=${typeof window !== "undefined" ? location.hostname : ""}&v=${packageJson.version}`}
          target="_blank"
          className="hover:underline hover:text-fg"
          rel="noreferrer"
        >
          Mailclaw v{packageJson.version}
        </a>
      </p>
	);
}
