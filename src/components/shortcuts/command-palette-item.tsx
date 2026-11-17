"use client";

import React from "react";
import { Kbd } from "@orangesys/ui";
import type { CommandItem } from "./types";

interface CommandPaletteItemProps {
  id: string;
  item: CommandItem;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function CommandPaletteItem({
  id,
  item,
  isActive,
  onSelect,
  onHover,
}: CommandPaletteItemProps) {
  const Icon = item.icon;

  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={isActive}
      tabIndex={-1}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={`relative w-full text-start px-3 py-2.5 flex items-center justify-between transition-colors ${
        isActive
          ? "bg-accent-subtle text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent"
          : "text-fg hover:bg-surface-hover"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <Icon
            className={`w-4 h-4 shrink-0 ${
              isActive
                ? "text-accent-text"
                : "text-fg-subtle"
            }`}
          />
        )}
        <div className="truncate">
          <span className="text-sm font-medium">{item.title}</span>
          {item.subtitle && (
            <span
              className={`ms-2 text-xs truncate ${
                isActive
                  ? "text-accent-text"
                  : "text-fg-subtle"
              }`}
            >
              {item.subtitle}
            </span>
          )}
        </div>
      </div>
      {item.shortcut && (
        <Kbd size="sm" className="shrink-0">{item.shortcut}</Kbd>
      )}
    </button>
  );
}
