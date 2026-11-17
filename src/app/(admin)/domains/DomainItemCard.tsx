import { Fragment } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/language-provider";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Tag } from "@orangesys/ui";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list";
import { cn } from "@/lib/utils";
import DomainDnsDetails from "./DomainDnsDetails";
import DomainDnsSkeleton from "./DomainDnsSkeleton";
import { dnsAuthRecords, getDnsAuthStatusLabel } from "./utils";
import {
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Globe2,
  MoreVertical,
  Trash2,
} from "@/components/icons";
import type { DomainItemCardProps } from "./types";

function StatusIcon({ ok, className }: { ok: boolean; className?: string }) {
  if (ok) return <Check className={cn(className, "text-success")} />;
  return <AlertTriangle className={cn(className, "text-warning")} />;
}

export default function DomainItemCard({
  item,
  dns,
  dnsDetails,
  onSendingProviderChange,
  sendingProviderBusy,
  sendingProviderMessage,
  onReceivingProviderChange,
  receivingProviderBusy,
  receivingProviderMessage,
  onDnsChanged,
  dnsLoading = false,
  dnsError,
  expanded = false,
  remove,
  onToggleDns,
  onSetup,
  setupRecord,
  setupMessage,
}: DomainItemCardProps) {
  const { t } = useLanguage();
  const auth = dns?.auth;

  return (
    <ListRow className="group relative flex-col items-stretch gap-4 max-md:p-4">
      <div className="flex flex-col items-start gap-3 md:flex-row md:gap-4">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-line bg-canvas-subtle text-fg-muted">
          <Globe2 className="h-5 w-5" />
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party favicon removed on error; next/image would need the host allow-listed */}
          <img
            src={`https://${item.hostname}/favicon.ico`}
            alt=""
            className="absolute inset-0 h-full w-full object-contain p-1"
            onError={(event) => event.currentTarget.remove()}
          />
        </span>

        <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
          <span className="min-w-0 truncate pe-10 font-display text-base font-semibold text-fg">
            {item.hostname}
          </span>

          <div className="flex flex-wrap gap-2">
            <Tag size="sm" tone={item.status === "active" ? "success" : "warning"}>
              {item.status === "active" ? t("dns.status.active") : item.status === "pending" ? t("dns.status.pending") : item.status}
            </Tag>
            {item.receivingProvider === "cloudflare" ? (
              <Tag size="sm" tone={item.routingEnabled ? "success" : "warning"}>
                {t("domains.badge.routing")}
              </Tag>
            ) : item.receivingProvider === "none" ? (
              <Tag size="sm" className="text-fg-muted">
                {t("domains.badge.sendingOnly")}
              </Tag>
            ) : (
              <Tag size="sm">
                {t("domains.badge.receivingVia", { provider: item.receivingProvider === "ses" ? "Amazon SES" : "Resend" })}
              </Tag>
            )}
            {item.sendingProvider === "resend" || item.sendingProvider === "ses" ? (
              <Tag size="sm" tone="success">
                {t("domains.badge.sendingVia", { provider: item.sendingProvider === "ses" ? "Amazon SES" : "Resend" })}
              </Tag>
            ) : item.sendingProvider === "none" ? (
              <Tag size="sm" className="text-fg-muted">
                {t("domains.badge.receivingOnly")}
              </Tag>
            ) : (
              <Tag size="sm" tone={item.sendingEnabled ? "success" : "warning"}>
                {t("domains.badge.sending")}
              </Tag>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {auth &&
              dnsAuthRecords.map((record, index) => (
                <Fragment key={record}>
                  {index > 0 && <span className="text-line-strong" aria-hidden="true">|</span>}
                  <span
                    className="flex items-center gap-1 text-fg-muted"
                    title={`${record.toUpperCase()} · ${getDnsAuthStatusLabel(auth[record], t)}`}
                  >
                    <span className="font-mono uppercase">{record}</span>
                    <StatusIcon
                      ok={auth[record] === "ok"}
                      className="h-3.5 w-3.5"
                    />
                  </span>
                </Fragment>
              ))}
            <span className="flex-1" />
            <button
              onClick={() => onToggleDns(item.id)}
              aria-expanded={expanded}
              className="flex cursor-pointer items-center gap-0.5 font-display text-xs font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {expanded ? (
                <>
                  {t("domains.hideDetails")} <ChevronRight className="h-3 w-3 rtl:-scale-x-100" />
                </>
              ) : (
                <>
                  {t("domains.showDetails")} <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {expanded &&
        (dnsDetails ? (
          <DomainDnsDetails
            domain={item}
            dns={dnsDetails}
            onSendingProviderChange={onSendingProviderChange}
            sendingProviderBusy={sendingProviderBusy}
            sendingProviderMessage={sendingProviderMessage}
            onReceivingProviderChange={onReceivingProviderChange}
            receivingProviderBusy={receivingProviderBusy}
            receivingProviderMessage={receivingProviderMessage}
            onDnsChanged={onDnsChanged}
            onSetup={onSetup}
            setupRecord={setupRecord}
            setupMessage={setupMessage}
          />
        ) : dnsError ? (
          <div className="border-t border-line pt-5 text-sm text-danger-text">
            {dnsError}
          </div>
        ) : dnsLoading ? (
          <DomainDnsSkeleton />
        ) : null)}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="absolute end-4 top-4 h-8 w-8 p-0"
            disabled={remove.isPending}
            aria-label={t("domains.actionsFor", { host: item.hostname })}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-40 border border-line bg-surface-raised p-1 text-sm text-fg shadow-lg"
          >
            <DropdownMenu.Item
              disabled={remove.isPending}
              onSelect={async () => {
                // Removing a domain deletes its mailboxes (and all their mail)
                // and disables Email Routing on the zone, so require the hostname.
                const confirmed = await confirmDestructive({ message: t("domains.removeConfirm", { host: item.hostname }), requireText: item.hostname });
                if (!confirmed) return;
                remove.mutate(item.id);
              }}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-danger-text outline-none hover:bg-danger-subtle focus:bg-danger-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t("domains.removeDomain")}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </ListRow>
  );
}
