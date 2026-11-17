"use client";

import React, { useId, useState, useEffect, useRef, useMemo } from "react";
import { Eyebrow, Kbd } from "@orangesys/ui";
import { Search, CornerDownLeft } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { CommandItem } from "./types";
import type { TranslationKey } from "@/lib/i18n/types";
import { filterCommands, groupCommandsByCategory } from "./command-palette-utils";
import { CommandPaletteItem } from "./command-palette-item";
import { useDialogFocus } from "@/components/use-dialog-focus";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

function CommandPaletteDialog({
  onClose,
  commands,
}: {
  onClose: () => void;
  commands: CommandItem[];
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  useDialogFocus(dialogRef, inputRef);

  const filteredCommands = useMemo(
    () => filterCommands(commands, query),
    [commands, query]
  );

  const activeIndex = Math.min(
    selectedIndex,
    Math.max(0, filteredCommands.length - 1)
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(
        (prev) => (prev - 1 + filteredCommands.length) % (filteredCommands.length || 1)
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[activeIndex]) {
        filteredCommands[activeIndex].perform();
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const grouped = useMemo(
    () => groupCommandsByCategory(filteredCommands),
    [filteredCommands]
  );

  let flatIndex = 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-overlay animate-in fade-in duration-100">
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.placeholder")}
        className="relative w-full max-w-xl bg-surface-raised text-fg border border-line shadow-lg overflow-hidden flex flex-col z-10"
        onKeyDown={handleKeyDown}
      >
        {/* Search header */}
        <div className="flex items-center px-4 py-3.5 border-b border-line gap-3">
          <Search className="w-5 h-5 shrink-0 text-fg-subtle" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t("palette.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={filteredCommands.length ? optionId(activeIndex) : undefined}
            aria-label={t("palette.placeholder")}
            className="w-full bg-transparent text-fg placeholder:text-fg-subtle text-[15px] focus:outline-none"
          />
          <Kbd size="sm" className="shrink-0">ESC</Kbd>
        </div>

        {/* Results */}
        <div id={listboxId} role="listbox" aria-label={t("palette.placeholder")} className="max-h-80 overflow-y-auto p-2">
          {filteredCommands.length === 0 ? (
            <div role="status" className="p-8 text-center text-sm text-fg-subtle">
              {t("palette.noMatch", { query })}
            </div>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category} role="group" aria-label={t(`shortcut.category.${category}` as TranslationKey)} className="mb-2 last:mb-0">
                <Eyebrow aria-hidden="true" className="flex px-3 py-1">
                  {t(`shortcut.category.${category}` as TranslationKey)}
                </Eyebrow>
                {items.map((item) => {
                  const isCurrent = flatIndex === activeIndex;
                  const itemIndex = flatIndex;
                  flatIndex++;

                  return (
                    <CommandPaletteItem
                      key={item.id}
                      id={optionId(itemIndex)}
                      item={item}
                      isActive={isCurrent}
                      onSelect={() => {
                        item.perform();
                        onClose();
                      }}
                      onHover={() => setSelectedIndex(itemIndex)}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-canvas-subtle border-t border-line flex items-center justify-between text-xs text-fg-subtle">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd size="sm">↑↓</Kbd>
              {t("palette.navigate")}
            </span>
            <span className="flex items-center">
              <CornerDownLeft className="w-3 h-3 me-1 inline" />
              {t("palette.select")}
            </span>
          </div>
          <span className="font-mono text-[11px]">{t("palette.actions")}</span>
        </div>
      </div>
    </div>
  );
}

export function CommandPalette({
  isOpen,
  onClose,
  commands,
}: CommandPaletteProps) {
  if (!isOpen) return null;
  return <CommandPaletteDialog onClose={onClose} commands={commands} />;
}
