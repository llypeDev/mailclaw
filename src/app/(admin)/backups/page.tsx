"use client";

import { useRef, useState } from "react";
import { confirmDestructive } from "@/components/ui/confirm-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, EmptyState, Tag } from "@orangesys/ui";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DatabaseBackup,
  Download,
  MoreVertical,
  Play,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
} from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BACKUP_TABLE_GROUPS } from "@/lib/backups/table-groups";
import type { TranslationKey } from "@/lib/i18n/types";
import type { BackupItem, BackupSettings } from "./types";
import {
  WEEKDAYS,
  downloadBackup,
  fetchBackups,
  formatBackupDate,
  formatBackupSize,
  getStatusTone,
  removeBackup,
  restoreBackup,
  saveBackupSettings,
  startBackup,
} from "./utils";

export default function BackupsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const restoreInput = useRef<HTMLInputElement | null>(null);
  const savedSettings = useRef<BackupSettings | null>(null);
  // Local edits to the backup settings; until the first edit the loaded settings are shown.
  const [editedSettings, setSettings] = useState<BackupSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: fetchBackups,
    refetchInterval: (query) =>
      query.state.data?.backups.some(
        (backup) => backup.status === "queued" || backup.status === "running",
      )
        ? 5000
        : false,
  });

  const settings = editedSettings ?? backups.data?.settings ?? null;
  const lastSavedSettings = () => savedSettings.current ?? backups.data?.settings ?? null;

  const saveSettings = useMutation({
    mutationFn: saveBackupSettings,
    onSuccess: (_data, nextSettings) => {
      savedSettings.current = nextSettings;
      setSettingsOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });

  const autoSaveSettings = useMutation({
    mutationFn: saveBackupSettings,
    onMutate: (nextSettings) => setSettings(nextSettings),
    onSuccess: (_data, nextSettings) => { savedSettings.current = nextSettings; },
    onError: () => { const saved = lastSavedSettings(); if (saved) setSettings(saved); },
  });

  const runBackup = useMutation({
    mutationFn: startBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const deleteBackup = useMutation({
    mutationFn: removeBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const download = useMutation({ mutationFn: downloadBackup });
  const restore = useMutation({
    mutationFn: restoreBackup,
    // eslint-disable-next-line nextjs-js/no-location-assign-relative-destination -- after a restore the app reloads from scratch, dropping all client state from before it
    onSuccess: () => window.location.assign("/login"),
  });
  const error =
    backups.error ||
    saveSettings.error ||
    autoSaveSettings.error ||
    runBackup.error ||
    deleteBackup.error ||
    download.error ||
    restore.error;
  const configuration = backups.data?.configuration;
  const backupConfigured = configuration?.configured === true;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-fg md:text-3xl">
            {t("backups.title")}
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            {t("backups.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            ref={restoreInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file || !await confirmDestructive(t("backups.restoreConfirm"))) return;
              restore.mutate(file);
            }}
          />
          <Button onClick={() => runBackup.mutate()} disabled={runBackup.isPending || !backupConfigured}>
            <Play size={18} />
            {runBackup.isPending ? t("backups.starting") : t("backups.backUp")}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button type="button" variant="outline" className="h-10 w-10 px-0" aria-label={t("backups.actions")}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 border border-line-strong bg-surface-raised p-1 text-sm shadow-lg">
                <DropdownMenu.Item disabled={restore.isPending} onSelect={() => restoreInput.current?.click()} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
                  <Upload className="h-4 w-4" />
                  {restore.isPending ? t("backups.restoring") : t("backups.restore")}
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={!settings || autoSaveSettings.isPending} onSelect={() => setSettingsOpen(true)} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-fg outline-none hover:bg-surface-hover focus:bg-surface-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
                  <Settings className="h-4 w-4" />
                  {t("backups.settings")}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("backups.tablesTitle")}</DialogTitle>
            <DialogDescription>{t("backups.tablesDescription")}</DialogDescription>
          </DialogHeader>
          {settings && <div className="space-y-5">
            <div className="divide-y divide-line">
              {BACKUP_TABLE_GROUPS.map((group) => {
                const enabled = !settings.excludedTableGroups.includes(group.id);
                const lastEnabled = enabled && settings.excludedTableGroups.length === BACKUP_TABLE_GROUPS.length - 1;
                return <div key={group.id} className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0"><p className="text-sm font-medium text-fg">{group.label}</p><p className="mt-1 break-words text-xs text-fg-subtle">{t("backups.tables", { list: group.tables.join(", ") })}</p></div>
                  <Switch checked={enabled} disabled={lastEnabled} onCheckedChange={(checked) => setSettings({ ...settings, excludedTableGroups: checked ? settings.excludedTableGroups.filter((id) => id !== group.id) : [...settings.excludedTableGroups, group.id] })} aria-label={t("backups.backUpGroup", { group: group.label })} />
                </div>;
              })}
            </div>
            {saveSettings.error && <p role="alert" className="text-sm text-danger-text">{saveSettings.error instanceof Error ? saveSettings.error.message : t("backups.saveSettingsFailed")}</p>}
            <Button onClick={() => saveSettings.mutate(settings)} disabled={saveSettings.isPending}><Save className="h-4 w-4" />{saveSettings.isPending ? t("common.saving") : t("backups.saveSettings")}</Button>
          </div>}
        </DialogContent>
      </Dialog>

      {error && (
        <Alert tone="danger">
          {error instanceof Error ? error.message : t("backups.operationFailed")}
        </Alert>
      )}

      {configuration && !configuration.configured && (
        <Alert
          tone="warning"
          title={t("backups.setupTitle")}
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={backups.isFetching}
              onClick={() => void backups.refetch()}
            >
              <RefreshCw
                className={`h-4 w-4 ${backups.isFetching ? "animate-spin" : ""}`}
              />
              {t("backups.checkAgain")}
            </Button>
          }
        >
          <p>{t("backups.setupDescription")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {configuration.missing.map((item) => (
              <Tag key={item} size="sm" tone="warning" className="font-mono">
                {item}
              </Tag>
            ))}
          </div>
        </Alert>
      )}

      <Card className="border border-line bg-surface p-6">
        <CardHeader className="py-0">
          <CardTitle>{t("backups.automatic")}</CardTitle>
          <CardDescription>
            {t("backups.scheduleNote")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {settings && (
            <>
              <div className="flex items-center justify-between gap-4 border-t border-line pt-5">
                <Label htmlFor="automatic-backup-switch">{t("backups.enableAutomatic")}</Label>
                <Switch
                  id="automatic-backup-switch"
                  checked={settings.enabled}
                  disabled={autoSaveSettings.isPending}
                  onCheckedChange={(enabled) => autoSaveSettings.mutate({ ...settings, enabled })}
                />
              </div>
              {settings.enabled && (
                <>
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="schedule-type" className="flex-1">{t("backups.frequency")}</Label>
                      <Select
                        id="schedule-type"
                        value={settings.scheduleType}
                        containerClassName="w-1/2 max-w-52 shrink-0 text-sm"
                        disabled={autoSaveSettings.isPending}
                        onChange={(event) => {
                          const scheduleType = event.target
                            .value as BackupSettings["scheduleType"];
                          autoSaveSettings.mutate({
                            ...settings,
                            scheduleType,
                            scheduleValue:
                              scheduleType === "weekly"
                                ? 1
                                : scheduleType === "monthly"
                                  ? 1
                                  : null,
                          });
                        }}
                        className="px-3 py-2"
                      >
                        <option value="daily">{t("backups.daily")}</option>
                        <option value="weekly">{t("backups.weekly")}</option>
                        <option value="monthly">{t("backups.monthly")}</option>
                      </Select>
                    </div>

                    {settings.scheduleType === "weekly" && (
                      <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="weekday">{t("backups.dayOfWeek")}</Label>
                        <Select
                          id="weekday"
                          value={settings.scheduleValue ?? 1}
                          containerClassName="w-1/2 max-w-52 shrink-0"
                          disabled={autoSaveSettings.isPending}
                          onChange={(event) =>
                            autoSaveSettings.mutate({
                              ...settings,
                              scheduleValue: Number(event.target.value),
                            })
                          }
                          
                        className="px-3 py-2 text-sm"
                        >
                          {WEEKDAYS.map((day) => (
                            <option key={day.value} value={day.value}>
                              {t(day.labelKey)}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}

                    {settings.scheduleType === "monthly" && (
                      <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="month-day">{t("backups.dayOfMonth")}</Label>
                        <Input
                          id="month-day"
                          className="w-1/2 max-w-52 shrink-0"
                          type="number"
                          min={1}
                          max={28}
                          value={settings.scheduleValue ?? 1}
                          disabled={autoSaveSettings.isPending}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              scheduleValue: Number(event.target.value),
                            })
                          }
                          onBlur={(event) => {
                            if (event.currentTarget.checkValidity()) autoSaveSettings.mutate(settings);
                            else setSettings({ ...settings, scheduleValue: lastSavedSettings()?.scheduleValue ?? 1 });
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 border-t border-line pt-5">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="retention-switch">{t("backups.deleteOld")}</Label>
                      <Switch
                        id="retention-switch"
                        checked={settings.retentionEnabled}
                        disabled={autoSaveSettings.isPending}
                        onCheckedChange={(retentionEnabled) =>
                          autoSaveSettings.mutate({
                            ...settings,
                            retentionEnabled,
                          })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="retention-days">
                        {t("backups.deleteOlderThan")}
                      </Label>
                      <div className="flex w-1/2 max-w-52 shrink-0 items-center gap-2 relative">
                        <Input
                          id="retention-days"
                          className="min-w-0"
                          type="number"
                          min={1}
                          max={3650}
                          value={settings.retentionDays}
                          disabled={!settings.retentionEnabled || autoSaveSettings.isPending}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              retentionDays: Number(event.target.value),
                            })
                          }
                          onBlur={(event) => {
                            if (event.currentTarget.checkValidity()) autoSaveSettings.mutate(settings);
                            else setSettings({ ...settings, retentionDays: lastSavedSettings()?.retentionDays ?? 30 });
                          }}
                        />
                        <span className="pointer-events-none absolute end-6 z-10 text-sm text-fg-subtle">{t("backups.days")}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <section className="overflow-hidden border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-4">
          <DatabaseBackup className="h-5 w-5 text-fg-subtle" />
          <h2 className="font-display font-semibold text-fg">{t("backups.history")}</h2>
        </div>
        <div className="grid grid-cols-[1fr_110px_110px_170px_120px] gap-4 border-b border-line-strong bg-canvas-subtle px-4 py-2 font-display text-[length:var(--or-text-2xs)] font-medium uppercase tracking-[var(--or-tracking-meta)] text-fg-subtle">
          <span>{t("backups.col.file")}</span>
          <span>{t("backups.col.status")}</span>
          <span>{t("backups.col.size")}</span>
          <span>{t("backups.col.created")}</span>
          <span>{t("backups.col.actions")}</span>
        </div>
        {backups.isLoading && <SkeletonRows count={5} />}
        {!backups.isLoading && (backups.data?.backups ?? []).length === 0 && (
          <EmptyState
            variant="compact"
            icon={<DatabaseBackup className="h-5 w-5" />}
            title={t("backups.none")}
          />
        )}
        {(backups.data?.backups ?? []).map((backup: BackupItem) => (
          <div
            key={backup.id}
            className="grid grid-cols-[1fr_110px_110px_170px_120px] items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">
                {backup.filename ?? backup.id}
              </p>
              <p className="truncate text-xs text-fg-subtle">
                {backup.trigger === "manual" ? t("backups.manual") : t("backups.scheduled")}
                {backup.error ? `: ${backup.error}` : ""}
              </p>
            </div>
            <span className="min-w-0">
              <Tag size="sm" tone={getStatusTone(backup.status)}>
                {t(`backups.status.${backup.status}` as TranslationKey)}
              </Tag>
            </span>
            <span className="text-sm tabular-nums text-fg-muted">
              {formatBackupSize(backup.size)}
            </span>
            <span className="text-sm text-fg-muted">
              {formatBackupDate(backup.createdAt)}
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                title={t("backups.download")}
                disabled={backup.status !== "completed" || download.isPending}
                onClick={() => download.mutate(backup)}
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title={t("backups.delete")}
                disabled={
                  deleteBackup.isPending ||
                  backup.status === "queued" ||
                  backup.status === "running"
                }
                onClick={() => deleteBackup.mutate(backup.id)}
              >
                <Trash2 className="h-4 w-4 text-danger-text" />
              </Button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
