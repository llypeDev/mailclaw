import Link from "next/link";
import type { DragEvent } from "react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { getMessageDragData } from "@/lib/messages/drag-utils";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useConversationView } from "@/components/messages/use-conversation-view";
import { useSelectedMailbox } from "./mailbox-provider";
import { useSidebar } from "./sidebar-state";
import { useCompose } from "./compose/compose-context";
import { Tooltip } from "./ui/tooltip";
import { FULL_ROUTE_PREFETCH } from "@/lib/navigation/prefetch";
import { preloadMailboxPage } from "./components-nav-utils";
import type { NavLink } from "./components-nav-types";

type Props = {
  link: NavLink,
  iconClassName?: string,
  labelClassName?: string,
  wrap?: boolean
}
export function NavItem({ link, iconClassName, labelClassName, wrap }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { openComposer } = useCompose();
  const { selectedMailbox } = useSelectedMailbox();
  const { minimal } = useSidebar();
  const { query } = useMailSearch();
  const [conversationView] = useConversationView();
  const [dragOver, setDragOver] = useState(false);
  const prefetchedKey = useRef<string | null>(null);

  if (!link.href) {
    return <span className="flex-1" />;
  }

  const Icon = link.icon;
  if (!Icon) return null;
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
  // Square rows; the current page is accent-subtle with a 2px accent bar on the start edge.
  const classes = cn(
    "relative flex h-9 items-center gap-3 text-sm text-fg-muted transition-colors max-md:min-h-11 max-md:text-base",
    minimal && "mx-auto w-10 justify-center px-0",
    active
      ? "bg-accent-subtle font-semibold text-accent-text before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent"
      : "hover:bg-surface-hover hover:text-fg",
    dragOver && "bg-accent-subtle text-accent-text ring-1 ring-inset ring-accent-border",
    link.primary &&
    "mb-3 h-12 w-fit bg-accent px-5 font-display font-semibold text-on-accent before:hidden hover:bg-accent-hover hover:text-on-accent",
    link.count && "font-semibold",
    link.primary && minimal && "h-11 w-11 px-0",
    wrap && !minimal && "h-auto min-h-9 items-start py-2",
  );
  const dropProps = link.onMessageDrop
    ? {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (event: DragEvent) => {
        const payload = getMessageDragData(event.dataTransfer);
        setDragOver(false);
        if (!payload) return;
        event.preventDefault();
        link.onMessageDrop?.(payload.messageIds);
      },
    }
    : {};

  if (link.href === "/compose") {
    const composeButton = (
      <button
        type="button"
        onClick={() => openComposer()}
        className={cn(!minimal && "ms-3", classes)}
        aria-label={minimal ? link.label : undefined}
        {...dropProps}
      >
        <Icon
          size={19}
          style={{ color: link.iconColor }}
          className={iconClassName}
          strokeWidth={2}
        />
        {!minimal && <span className={cn("flex-1", typeof link.count === "number" && link.count > 0 && "font-semibold")}>{link.label}</span>}
        {!minimal && typeof link.count === "number" && link.count > 0 && (
          <span className="ms-auto me-3 px-2 py-0.5 text-sm font-semibold tabular-nums">
            {link.count > 99 ? "99+" : link.count}
          </span>
        )}
        {minimal && typeof link.count === "number" && link.count > 0 && (
          <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-on-accent">
            {link.count > 99 ? "99+" : link.count}
          </span>
        )}
      </button>
    );
    return minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{composeButton}</Tooltip> : composeButton;
  }

  function prefetch() {
    if (!link.preloadMessages || active || !link.href) return;
    const key = [link.href, selectedMailbox?.id ?? "", query, conversationView].join("\u0000");
    if (prefetchedKey.current === key) return;
    prefetchedKey.current = key;
    router.prefetch(link.href, FULL_ROUTE_PREFETCH);
    void preloadMailboxPage(link.href, selectedMailbox?.id, { query, grouped: conversationView })
      .catch(() => { prefetchedKey.current = null; });
  }

  const navLink = (
    <Link
      href={link.href}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      aria-label={minimal ? link.label : undefined}
      className={cn(!minimal && "ps-6", classes)}
      {...dropProps}
    >
      <Icon
        // className={minimal ? "h-4 w-4" : "h-5 w-5"}
        style={{ color: link.iconColor }}
        size={16}
        strokeWidth={2}
        className={cn("max-md:h-5 max-md:w-5", wrap && !minimal && "mt-0.5 shrink-0", iconClassName)}
      />
      {!minimal && <span className={cn("flex-1", wrap && "min-w-0 break-words leading-5 max-md:leading-6", labelClassName, typeof link.count === "number" && link.count > 0 && "font-semibold")}>{link.label}</span>}
      {!minimal && typeof link.count === "number" && link.count > 0 && (
        <span className={cn("ms-auto me-3 px-2 py-0.5 text-sm font-semibold tabular-nums", wrap && "shrink-0 py-0 leading-5")}>
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
      {minimal && typeof link.count === "number" && link.count > 0 && (
        <span className="absolute -end-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 tabular-nums text-on-accent">
          {link.count > 99 ? "99+" : link.count}
        </span>
      )}
    </Link>
  );

  return (
    <>
      {minimal && link.label ? <Tooltip label={link.label} placement="right" className="mx-auto">{navLink}</Tooltip> : navLink}
    </>
  );
}
