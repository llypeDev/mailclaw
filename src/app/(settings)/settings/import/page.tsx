"use client";

import type { FormEvent } from "react";
import { Alert, ProgressBar } from "@orangesys/ui";
import { useMemo, useState } from "react";
import { ChevronDown, Upload } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ImportJobs } from "@/components/settings/import-jobs";
import { importMessageFiles } from "@/components/settings/import-messages-utils";
import { TakeoutImport } from "@/components/settings/takeout-import";
import { SettingsPageHeader, SettingsPanel, SettingsSection } from "@/components/settings/settings-section";
import { SETTING_FILE_INPUT_CLASS, SETTING_HINT_CLASS } from "@/components/settings/settings-section-utils";
import type {
  ImapFormState,
  ImportSourceItem,
  ImportSourceSection,
  ImportTab,
  ImportProgress,
} from "./types";
import {
  ensureImportDestination,
  fetchImapFolders,
  filterCustomImapFolders,
  getFileImportSource,
  getFolderImportSource,
  getSelectedImportSources,
  importSourceOptions,
  resolveImapSourceFolder,
  startImapImport,
} from "./utils";

const initialImapForm: ImapFormState = {
  host: "",
  port: "993",
  secure: true,
  username: "",
  password: "",
  folder: "INBOX",
  limit: "100",
  importAll: true,
};

const defaultSections = importSourceOptions.map((option) => option.value);

const SECTION_LABEL_KEYS: Record<ImportSourceSection, TranslationKey> = {
  inbox: "navigation.inbox",
  sent: "navigation.sent",
  drafts: "navigation.drafts",
  archived: "navigation.archived",
  spam: "navigation.spam",
  trash: "navigation.trash",
  others: "importPage.others",
};

export default function SettingsImportPage() {
  const { t } = useLanguage();
  // System sections are translated; folders discovered on the source keep their own names.
  const sourceLabel = (source: ImportSourceItem) => source.sourceSection ? t(SECTION_LABEL_KEYS[source.sourceSection]) : source.label;
  const { selectedMailbox } = useSelectedMailbox();
  const [activeTab, setActiveTab] = useState<ImportTab>("file");
  const [selectedSections, setSelectedSections] =
    useState<ImportSourceSection[]>(defaultSections);
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileStarted, setFileStarted] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileProgress, setFileProgress] = useState<ImportProgress | null>(null);
  const [imapForm, setImapForm] = useState<ImapFormState>(initialImapForm);
  const [imapStarted, setImapStarted] = useState(false);
  const [jobsRefresh, setJobsRefresh] = useState(0);
  const [imapError, setImapError] = useState<string | null>(null);
  const [imapLoading, setImapLoading] = useState(false);
  const [imapProgress, setImapProgress] = useState<ImportProgress | null>(null);
  const selectedSources = useMemo(
    () => getSelectedImportSources(selectedSections),
    [selectedSections],
  );
  const fileImportSource = getFileImportSource(selectedSources);
  const sourceSummary =
    selectedSources.length > 0
      ? selectedSources.map(sourceLabel).join(", ")
      : t("importPage.selectSections");

  function toggleSection(section: ImportSourceSection, checked: boolean) {
    setSelectedSections((current) => {
      if (checked)
        return current.includes(section) ? current : [...current, section];
      return current.filter((item) => item !== section);
    });
  }

  async function getDestination(source: ImportSourceItem): Promise<string> {
    if (!selectedMailbox?.id) throw new Error(t("importPage.selectMailboxFirst"));
    return ensureImportDestination(selectedMailbox.id, source);
  }

  async function onFileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMailbox?.id || selectedSources.length === 0) return;

    setFileLoading(true);
    setFileError(null);
    setFileStarted(false);
    setFileProgress({ completed: 0, total: 100, label: t("importPage.preparing") });
    try {
      const destination = await getDestination(fileImportSource);
      await importMessageFiles(
        selectedMailbox.id,
        files,
        destination,
        (percentage) =>
          setFileProgress({
            completed: percentage,
            total: 100,
            label: t("importPage.uploading"),
          }),
      );
      setFileStarted(true);
      setJobsRefresh((count) => count + 1);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : t("importPage.fileFailed"),
      );
    } finally {
      setFileLoading(false);
      setFileProgress(null);
    }
  }

  async function onImapSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMailbox?.id || selectedSources.length === 0) return;
    setImapLoading(true);
    setImapError(null);
    setImapStarted(false);
    setImapProgress({
      completed: 0,
      total: 1,
      label: t("importPage.discovering"),
    });
    try {
      const discoveredFolders = await fetchImapFolders(imapForm);
      const expandedSources: ImportSourceItem[] = [];
      for (const source of selectedSources) {
        if (source.id === "system:others") {
          expandedSources.push(
            ...filterCustomImapFolders(discoveredFolders, selectedSources).map(
              getFolderImportSource,
            ),
          );
        } else {
          expandedSources.push(source);
        }
      }

      const sources: { folder: string; destination: string }[] = [];
      for (const source of expandedSources) {
        sources.push({
          folder: resolveImapSourceFolder(source, discoveredFolders),
          destination: await getDestination(source),
        });
      }
      await startImapImport(selectedMailbox.id, imapForm, sources);
      setImapStarted(true);
      setJobsRefresh((count) => count + 1);
      setImapForm((current) => ({ ...current, password: "" }));
    } catch (error) {
      setImapError(
        error instanceof Error ? error.message : t("importPage.imapFailed"),
      );
    } finally {
      setImapLoading(false);
      setImapProgress(null);
    }
  }

  return (
    <div className="space-y-8 py-4">
      <SettingsPageHeader eyebrow={t("settings.nav.mailbox")} title={t("settings.nav.import")} />

      <ImportJobs refreshKey={jobsRefresh} />

      <SettingsSection title={t("importPage.title")} description={t("importPage.description")}>
          <SettingsPanel className="space-y-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-source">{t("importPage.source")}</Label>
              <Select
                id="import-source"
                value={activeTab}
                onChange={(event) =>
                  setActiveTab(event.target.value as ImportTab)
                }
                className="h-10 w-full text-sm"
              >
                <option value="file">{t("importPage.backupFile")}</option>
                <option value="imap">{t("importPage.imap")}</option>
                <option value="takeout">{t("importPage.takeout")}</option>
              </Select>
            </div>
            {activeTab === "takeout" ? (
              <TakeoutImport />
            ) : (
            <>
            <div className="space-y-2">
              <Label>{t("importPage.chooseSections")}</Label>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSourceDropdownOpen((open) => !open)}
                  aria-expanded={sourceDropdownOpen}
                  className="flex h-10 w-full items-center justify-between border border-line-control bg-surface px-3 py-2 text-start text-sm text-fg transition-colors hover:border-fg-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                >
                  <label className="flex-1">{t("importPage.selected")}</label>
                  <span className="truncate">{sourceSummary}</span>
                  <ChevronDown className={`ms-2 h-4 w-4 shrink-0 text-fg-muted transition-transform ${sourceDropdownOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {sourceDropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full border border-line-strong bg-surface-raised py-1 shadow-lg">
                    {importSourceOptions.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-hover"
                      >
                        <Checkbox
                          checked={selectedSections.includes(option.value)}
                          onChange={(event) =>
                            toggleSection(option.value, event.target.checked)
                          }
                        />
                        {t(SECTION_LABEL_KEYS[option.value])}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {activeTab === "file" ? (
              <>
                <form onSubmit={onFileSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="import-files">{t("importPage.selectFile")}</Label>
                    <Input
                      id="import-files"
                      type="file"
                      accept=".eml,.mbox,.mbx,message/rfc822,application/mbox"
                      multiple
                      onChange={(event) =>
                        setFiles(Array.from(event.target.files ?? []))
                      }
                      className={SETTING_FILE_INPUT_CLASS}
                    />
                    <p className={SETTING_HINT_CLASS}>
                      {t("importPage.fileHint", { section: sourceLabel(fileImportSource) })}
                    </p>
                  </div>
                  {selectedSections.includes("others") && (
                    <Alert tone="warning">
                      {t("importPage.othersNote")}
                    </Alert>
                  )}
                  <Button
                    type="submit"
                    disabled={
                      !selectedMailbox ||
                      selectedSources.length === 0 ||
                      files.length === 0 ||
                      fileLoading
                    }
                  >
                    {fileLoading ? t("import.importing") : t("importPage.importFiles")}
                  </Button>
                  {fileProgress && (
                    <div aria-live="polite">
                      <ProgressBar
                        size="sm"
                        label={fileProgress.label}
                        value={fileProgress.completed}
                      />
                    </div>
                  )}
                  {fileStarted && (
                    <Alert tone="success" live>
                      {t("importJobs.started")}
                    </Alert>
                  )}
                  {fileError && (
                    <Alert tone="danger" live>
                      {fileError}
                    </Alert>
                  )}
                </form>
              </>
            ) : (
              <>
                <form onSubmit={onImapSubmit} className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                    <div className="space-y-2">
                      <Label htmlFor="imap-host">{t("importPage.host")}</Label>
                      <Input
                        id="imap-host"
                        value={imapForm.host}
                        onChange={(event) =>
                          setImapForm({ ...imapForm, host: event.target.value })
                        }
                        placeholder="imap.gmail.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="imap-port">{t("importPage.port")}</Label>
                      <Input
                        id="imap-port"
                        type="number"
                        value={imapForm.port}
                        onChange={(event) =>
                          setImapForm({ ...imapForm, port: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="imap-username">{t("importPage.username")}</Label>
                      <Input
                        id="imap-username"
                        value={imapForm.username}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            username: event.target.value,
                          })
                        }
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="imap-password">
                        {t("importPage.passwordOrApp")}
                      </Label>
                      <Input
                        id="imap-password"
                        type="password"
                        value={imapForm.password}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            password: event.target.value,
                          })
                        }
                        autoComplete="off"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="imap-limit">
                        {imapForm.importAll
                          ? t("importPage.perBatch")
                          : t("importPage.perSource")}
                      </Label>
                      <Input
                        id="imap-limit"
                        type="number"
                        min={1}
                        max={100}
                        value={imapForm.limit}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            limit: event.target.value,
                          })
                        }
                      />
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm text-fg">
                      <Checkbox
                        checked={imapForm.importAll}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            importAll: event.target.checked,
                          })
                        }
                      />
                      {t("importPage.importAll")}
                    </label>
                    <label className="flex items-end gap-2 pb-2 text-sm text-fg">
                      <Checkbox
                        checked={imapForm.secure}
                        onChange={(event) =>
                          setImapForm({
                            ...imapForm,
                            secure: event.target.checked,
                          })
                        }
                      />
                      {t("importPage.useTls")}
                    </label>
                  </div>
                  <Alert tone="info">
                    {t("importPage.imapNote")}
                  </Alert>
                  <Button
                    type="submit"
                    disabled={
                      !selectedMailbox ||
                      selectedSources.length === 0 ||
                      !imapForm.host ||
                      !imapForm.username ||
                      !imapForm.password ||
                      imapLoading
                    }
                  >
                    <Upload className="h-4 w-4" />
                    {imapLoading ? t("import.importing") : t("importPage.importSources")}
                  </Button>
                  {imapProgress && (
                    <div aria-live="polite">
                      <ProgressBar
                        size="sm"
                        label={imapProgress.label}
                        value={imapProgress.completed}
                        max={imapProgress.total}
                        formatValue={(value, info) => `${value}/${info.max}`}
                      />
                    </div>
                  )}
                  {imapStarted && (
                    <Alert tone="success" live>
                      {t("importJobs.started")}
                    </Alert>
                  )}
                  {imapError && (
                    <Alert tone="danger" live>
                      {imapError}
                    </Alert>
                  )}
                </form>
              </>
            )}
            </>
            )}
          </SettingsPanel>
      </SettingsSection>
    </div>
  );
}
