"use client";

import React, { useId, useRef } from "react";
import { Eyebrow, Kbd } from "@orangesys/ui";
import { X, Keyboard } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ShortcutDefinition } from "./types";
import { useDialogFocus } from "@/components/use-dialog-focus";

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: ShortcutDefinition[];
}

// Puts a styled key badge where the translation has its {key} placeholder.
function withKey(text: string, key: string) {
  const [before, after = ""] = text.split("{key}");
  return (
    <>
      {before}
      <Kbd size="sm">{key}</Kbd>
      {after}
    </>
  );
}

export function ShortcutsHelpDialog({ isOpen, onClose, shortcuts }: ShortcutsHelpDialogProps) {
  if (!isOpen) return null;
  return <ShortcutsHelpDialogContent onClose={onClose} shortcuts={shortcuts} />;
}

function ShortcutsHelpDialogContent({
  onClose,
  shortcuts,
}: Omit<ShortcutsHelpDialogProps, "isOpen">) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useDialogFocus(dialogRef, closeRef);

  const grouped = shortcuts.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ShortcutDefinition[]>);

  const formatKey = (shortcut: ShortcutDefinition) => {
    const parts: string[] = [];
    if (shortcut.modifiers) {
      shortcut.modifiers.forEach((m) => {
        if (m === "ctrl") parts.push(t("shortcutsHelp.ctrl"));
        if (m === "meta") parts.push("⌘");
        if (m === "alt") parts.push("Alt");
        if (m === "shift") parts.push("Shift");
      });
    }
    parts.push(shortcut.key.toUpperCase());
    return parts.join(" + ");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay animate-in fade-in duration-100">
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape" && event.key !== "?") return;
          event.stopPropagation();
          onClose();
        }}
        className="relative w-full max-w-2xl bg-surface-raised text-fg border border-line shadow-lg overflow-hidden flex flex-col z-10 max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-accent-subtle text-accent-text">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h2 id={titleId} className="font-display text-base font-bold text-fg">
                {t("shortcutsHelp.title")}
              </h2>
              <p className="text-xs text-fg-subtle">
                {t("shortcutsHelp.subtitle")}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("shortcutsHelp.close")}
            className="text-fg-subtle hover:text-fg p-1.5 hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Categories */}
        <div className="overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <Eyebrow as="h3" className="flex border-b border-line pb-1.5">
                {t(`shortcut.category.${category}` as TranslationKey)}
              </Eyebrow>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-fg-muted">
                      {item.label}
                    </span>
                    <Kbd size="sm" className="shrink-0">{formatKey(item)}</Kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-canvas-subtle border-t border-line flex items-center justify-between text-xs text-fg-subtle">
          <span>{withKey(t("shortcutsHelp.pressToToggle", { key: "{key}" }), "?")}</span>
          <span>{withKey(t("shortcutsHelp.pressToClose", { key: "{key}" }), "ESC")}</span>
        </div>
      </div>
    </div>
  );
}
