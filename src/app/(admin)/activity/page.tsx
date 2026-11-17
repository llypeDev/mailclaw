"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag } from "@orangesys/ui";
import { LogIn, LogOut } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchActivity,
  formatActivityDate,
  getActivityLabel,
  getActivityMetadata,
} from "./utils";

export default function ActivityPage() {
  const { t } = useLanguage();
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: fetchActivity,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">{t("activity.title")}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {t("activity.description")}
        </p>
      </div>

      <section role="region" tabIndex={0} aria-label={t("activity.title")} className="overflow-x-auto border border-line bg-surface">
        <table className="w-full min-w-[760px] table-fixed text-start">
          <thead className="border-b border-line-strong bg-canvas-subtle font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">
            <tr>
              <th scope="col" className="w-32 px-5 py-3 text-start font-medium">{t("activity.col.activity")}</th>
              <th scope="col" className="px-5 py-3 text-start font-medium">{t("activity.col.user")}</th>
              <th scope="col" className="w-64 px-5 py-3 text-start font-medium">{t("activity.col.device")}</th>
              <th scope="col" className="w-48 px-5 py-3 text-start font-medium">{t("activity.col.time")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {activity.isLoading &&
              Array.from({ length: 7 }, (_, index) => (
                <tr key={index}>
                  <td className="px-5 py-4">
                    <Skeleton className="h-6 w-20" />
                  </td>
                  <td className="px-5 py-4">
                    <Skeleton className="h-9 w-48" />
                  </td>
                  <td className="px-5 py-4">
                    <Skeleton className="h-9 w-40" />
                  </td>
                  <td className="px-5 py-4">
                    <Skeleton className="h-4 w-32" />
                  </td>
                </tr>
              ))}
            {!activity.isLoading && (activity.data ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-4 text-sm text-fg-subtle">
                  {t("activity.none")}
                </td>
              </tr>
            )}
            {(activity.data ?? []).map((log) => {
              const metadata = getActivityMetadata(log);
              const Icon = log.action === "auth.logout" ? LogOut : LogIn;
              return (
                <tr key={log.id} className="align-top transition-colors hover:bg-surface-hover">
                  <td className="px-5 py-4">
                    <Tag size="sm" tone={log.action === "auth.logout" ? "neutral" : "info"} icon={<Icon className="h-3 w-3" />}>
                      {getActivityLabel(log.action, t)}
                    </Tag>
                  </td>
                  <td className="px-5 py-4">
                    <p className="flex flex-col truncate no-font-mono">
                      <span>{log.actorEmail ?? t("activity.unknownEmail")}</span>
                    </p>
                    <small className="text-fg-subtle">
                      {metadata.city || t("activity.unknownCity")} •{" "}
                      {metadata.country || t("activity.unknownCountry")}
                    </small>
                  </td>
                  <td className="px-5 py-4">
                    <p className="flex flex-col truncate no-font-mono">
                      {metadata.device ?? t("activity.unknownDevice")}
                    </p>

                    <small className="text-fg-subtle">
                      {metadata.platform || t("activity.unknownPlatform")} •{" "}
                      {metadata.ipAddress ?? t("activity.unknownIp")}
                    </small>
                  </td>
                  <td className="px-5 py-4 text-sm text-fg-subtle">
                    {formatActivityDate(log.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
