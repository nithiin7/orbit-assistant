"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  DocumentCategory,
  DocumentDetail,
  DocumentFolder,
  DocumentLinkKind,
  DocumentRecord,
} from "@orbit/contracts";
import {
  ArrowLeft,
  BellRing,
  Download,
  FileText,
  Folder,
  History,
  Link2,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { AssistMenu } from "@/components/ai/assist-menu";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { ExternalOrigin } from "@/components/integrations/external-origin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDocument, useDocumentMutations, useDocumentSettings } from "@/hooks/use-documents";
import { ASSIST_ACTIONS } from "@/lib/ai";
import {
  detailsValues,
  documentDetailsSchema,
  type DocumentDetailsValues,
  formatFileSize,
  linkedRecordHref,
  linkKindLabel,
  REMINDER_DAY_CHOICES,
  reminderDayLabel,
  toUpdateRequest,
} from "@/lib/documents";
import { CURRENCY_OPTIONS } from "@/lib/finance";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";
import { folderPath } from "@/utils/folders";

import {
  categoryChoices,
  folderChoices,
  fromChoice,
  LinkRecordDialog,
  RenewDialog,
  toChoice,
} from "./document-dialogs";
import { CATEGORY_ICONS, ExpiryChip, FileIcon, LINK_ICONS } from "./document-meta";
import { DocumentPreview } from "./document-preview";
import { precheck } from "./upload";

type DocumentPaneProps = {
  workspaceId: string;
  documentId: string;
  folders: readonly DocumentFolder[];
  categories: readonly DocumentCategory[];
  today: string;
  onBack: () => void;
  onDownload: (document: DocumentRecord, versionId?: string | null) => void;
  onDeleted: (title: string) => void;
  onAnnounce: (message: string) => void;
  onConfirm: (title: string, description: string, confirmLabel: string) => Promise<boolean>;
};

type SettingsTab = "details" | "reminders" | "links" | "history";

const SETTINGS_TABS: readonly { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "details", label: "Details", icon: FileText },
  { id: "reminders", label: "Reminders", icon: BellRing },
  { id: "links", label: "Links", icon: Link2 },
  { id: "history", label: "History", icon: History },
];

/**
 * One document. Its file fills the page; details, reminders, links, and history open in a
 * settings panel beside it (above it on narrow screens) only when asked for.
 */
export function DocumentPane(props: DocumentPaneProps) {
  const { state, reload } = useDocument(props.workspaceId, props.documentId);
  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading document" className="space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onBack}>
            Back to documents
          </Button>
        </div>
      </div>
    );
  }
  return <DocumentDetailView {...props} detail={state.data} />;
}

function DocumentDetailView({
  workspaceId,
  detail,
  folders,
  categories,
  today,
  onBack,
  onDownload,
  onDeleted,
  onAnnounce,
  onConfirm,
}: DocumentPaneProps & { detail: DocumentDetail }) {
  const document = detail.document;
  const mutations = useDocumentMutations(workspaceId);
  const settings = useDocumentSettings(workspaceId);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [linking, setLinking] = useState(false);
  // A record without a file has nothing to show but its details, so those start open.
  const [settingsOpen, setSettingsOpen] = useState(!document.file);
  const [tab, setTab] = useState<SettingsTab>("details");
  const settingsId = useId();
  const trashed = document.state === "trashed";
  const category = categories.find((item) => item.id === document.category_id);
  const CategoryIcon = category ? CATEGORY_ICONS[category.icon] : null;
  const folderName = document.folder_id
    ? folderPath(folders, document.folder_id).join(" / ")
    : null;

  const run = (promise: Promise<unknown>, done: string, failure: string) =>
    promise.then(
      () => {
        setError(null);
        onAnnounce(done);
      },
      (reason: unknown) => setError(describeApiError(reason, failure)),
    );

  const change = (
    changes: Parameters<typeof mutations.update.mutateAsync>[0]["changes"],
    done: string,
  ) =>
    run(
      mutations.update.mutateAsync({ documentId: document.id, changes }),
      done,
      "Couldn’t save the change.",
    );

  const replace = (files: FileList | null) => {
    const file = files?.[0];
    if (replaceRef.current) replaceRef.current.value = "";
    if (!file) return;
    const problem = precheck(file, settings);
    if (problem) {
      setError(problem);
      return;
    }
    void run(
      mutations.uploadVersion.mutateAsync({ documentId: document.id, file }),
      document.file
        ? `Uploaded a new version of “${document.title}”.`
        : `Added the file to “${document.title}”.`,
      "Couldn’t upload the file.",
    );
  };

  const actions: MenuItem[] = trashed
    ? [
        {
          id: "restore",
          label: "Restore",
          onSelect: () =>
            void run(
              mutations.act.mutateAsync({ documentId: document.id, action: "restore" }),
              "Restored.",
              "Couldn’t restore it.",
            ),
        },
        {
          id: "delete",
          label: "Delete forever…",
          destructive: true,
          onSelect: () => {
            void onConfirm(
              `Delete “${document.title}” forever?`,
              "Its file and every earlier version are deleted. This can’t be undone.",
              "Delete forever",
            ).then((confirmed) => {
              if (!confirmed) return;
              mutations.remove.mutateAsync(document.id).then(
                () => onDeleted(document.title),
                (reason: unknown) => setError(describeApiError(reason, "Couldn’t delete it.")),
              );
            });
          },
        },
      ]
    : [
        ...(document.file
          ? [
              {
                id: "download",
                label: "Download",
                icon: Download,
                onSelect: () => onDownload(document),
              },
            ]
          : []),
        {
          id: "replace",
          label: document.file ? "Replace file…" : "Upload file…",
          icon: Upload,
          onSelect: () => replaceRef.current?.click(),
        },
        { id: "renew", label: "Record renewal…", icon: History, onSelect: () => setRenewing(true) },
        {
          id: "archive",
          label: document.archived_at ? "Unarchive" : "Archive",
          onSelect: () =>
            void change(
              { archived: !document.archived_at },
              document.archived_at ? "Unarchived." : "Archived. Its reminders are paused.",
            ),
        },
        {
          id: "trash",
          label: "Move to Trash",
          icon: Trash2,
          destructive: true,
          onSelect: () =>
            void run(
              mutations.act.mutateAsync({ documentId: document.id, action: "trash" }),
              `Moved “${document.title}” to the Trash.`,
              "Couldn’t move it to the Trash.",
            ),
        },
      ];

  return (
    <article aria-label={document.title} className="@container/pane space-y-5">
      <input
        ref={replaceRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={settings?.accepted_extensions.map((extension) => `.${extension}`).join(",")}
        onChange={(event) => replace(event.target.files)}
      />
      <header className="flex items-start gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 size-8 shrink-0"
          aria-label="Back to documents"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <FileIcon file={document.file} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight break-words">{document.title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {document.file ? (
              <span>
                {document.file.filename} · {formatFileSize(document.file.size_bytes)}
              </span>
            ) : (
              <span>No file yet</span>
            )}
            <ExpiryChip document={document} today={today} />
            {document.state !== "active" ? (
              <span className="rounded-full border border-dashed px-2 py-0.5">
                {document.state === "trashed" ? "In the Trash" : "Archived"}
              </span>
            ) : null}
            {category && CategoryIcon ? (
              <span className="inline-flex items-center gap-1">
                <CategoryIcon className="size-3.5" aria-hidden="true" />
                {category.name}
              </span>
            ) : null}
            {folderName ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{folderName}</span>
              </span>
            ) : null}
            {document.tags.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Tag className="size-3.5" aria-hidden="true" />
                {document.tags.map((name) => `#${name}`).join(" ")}
              </span>
            ) : null}
          </p>
          <div className="mt-1.5">
            <ExternalOrigin entityType="document" entityId={document.id} />
          </div>
        </div>
        {!trashed ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-pressed={document.is_favorite}
            aria-label={document.is_favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() =>
              void change(
                { is_favorite: !document.is_favorite },
                document.is_favorite ? "Removed from favorites." : "Added to favorites.",
              )
            }
          >
            <Star
              className={cn(document.is_favorite && "fill-current text-warning")}
              aria-hidden="true"
            />
          </Button>
        ) : null}
        {trashed ? null : (
          <AssistMenu module="documents" actions={ASSIST_ACTIONS.document} targetId={document.id} />
        )}
        {document.file && !trashed ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onDownload(document)}
          >
            <Download aria-hidden="true" />
            <span className="hidden @md/pane:inline">Download</span>
          </Button>
        ) : null}
        <Button
          variant={settingsOpen ? "soft" : "outline"}
          size="sm"
          className="shrink-0"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          aria-label={settingsOpen ? "Hide details" : "Show details"}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span className="hidden @md/pane:inline">Details</span>
        </Button>
        <Menu
          aria-label={`More actions for “${document.title}”`}
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          className="size-8 shrink-0"
          items={actions}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </header>

      {trashed ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          This document is in the Trash, so it can’t be changed. Restore it to edit it.
        </p>
      ) : null}
      <FormAlert message={error} />

      <div
        className={cn(
          // The panel's column (wide) or row (narrow) grows from nothing, so it slides in.
          "grid items-start transition-[grid-template-columns,gap] duration-300 ease-out motion-reduce:transition-none @4xl/pane:grid-cols-[minmax(0,1fr)_0rem]",
          settingsOpen ? "gap-6 @4xl/pane:grid-cols-[minmax(0,1fr)_24rem]" : "gap-0",
        )}
      >
        <div className="min-w-0">
          {document.file ? (
            <DocumentPreview
              workspaceId={workspaceId}
              documentId={document.id}
              file={document.file}
              title={document.title}
              onDownload={() => onDownload(document)}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center">
              <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">This record has no file yet.</p>
              {!trashed ? (
                <Button variant="soft" size="sm" onClick={() => replaceRef.current?.click()}>
                  <Upload aria-hidden="true" />
                  Upload its file
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {/* Kept mounted while closed, so closing the panel doesn't drop unsaved edits. */}
        <div
          inert={!settingsOpen}
          aria-hidden={settingsOpen ? undefined : true}
          className={cn(
            "order-first grid min-w-0 overflow-hidden transition-[grid-template-rows,opacity,visibility] duration-300 ease-out motion-reduce:transition-none @4xl/pane:sticky @4xl/pane:top-6 @4xl/pane:order-none @4xl/pane:grid-rows-[1fr]",
            settingsOpen
              ? "visible grid-rows-[1fr] opacity-100"
              : "invisible grid-rows-[0fr] opacity-0",
          )}
        >
          <aside
            id={settingsId}
            aria-label="Document details"
            className={cn(
              "flex min-h-0 w-full min-w-0 flex-col justify-self-end overflow-hidden rounded-xl border bg-card transition-transform duration-300 ease-out motion-reduce:transition-none @4xl/pane:max-h-[calc(100dvh-3rem)] @4xl/pane:w-[24rem]",
              settingsOpen ? "translate-x-0" : "@4xl/pane:translate-x-6",
            )}
          >
            <div className="flex items-center gap-2 border-b py-1.5 pr-1.5 pl-2">
              <SettingsTabs tab={tab} idPrefix={settingsId} onChange={setTab} />
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8 shrink-0"
                aria-label="Close details"
                onClick={() => setSettingsOpen(false)}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <div
              role="tabpanel"
              id={`${settingsId}-panel`}
              aria-labelledby={`${settingsId}-${tab}`}
              className="flex min-h-0 flex-1 flex-col"
            >
              {tab === "details" ? (
                <div className="border-b p-4">
                  <Organize
                    document={document}
                    folders={folders}
                    categories={categories}
                    readOnly={trashed}
                    onChange={(changes, done) => void change(changes, done)}
                  />
                </div>
              ) : null}
              <DetailsForm
                key={document.id}
                document={document}
                readOnly={trashed}
                tab={tab}
                nextReminderAt={detail.next_reminder_at}
                onSave={async (values) => {
                  const saved = await mutations.update.mutateAsync({
                    documentId: document.id,
                    changes: toUpdateRequest(values),
                  });
                  onAnnounce("Saved.");
                  return saved.document;
                }}
              />
              {tab === "links" ? (
                <div className="scrollbar-thin overflow-y-auto p-4">
                  <Links
                    detail={detail}
                    readOnly={trashed}
                    onLink={() => setLinking(true)}
                    onUnlink={(kind, id, title) =>
                      void run(
                        mutations.unlink.mutateAsync({ documentId: document.id, kind, id }),
                        `Unlinked “${title}”.`,
                        "Couldn’t unlink it.",
                      )
                    }
                  />
                </div>
              ) : null}
              {tab === "history" ? (
                <div className="scrollbar-thin space-y-6 overflow-y-auto p-4">
                  {detail.versions.length === 0 && detail.renewals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Earlier versions of the file and recorded renewals show up here.
                    </p>
                  ) : null}
                  <Versions
                    detail={detail}
                    readOnly={trashed}
                    onDownload={(versionId) => onDownload(document, versionId)}
                    onRestore={(versionId, number) =>
                      void run(
                        mutations.restoreVersion.mutateAsync({
                          documentId: document.id,
                          versionId,
                        }),
                        `Restored version ${number} as the current file.`,
                        "Couldn’t restore that version.",
                      )
                    }
                    onDelete={(versionId, number) => {
                      void onConfirm(
                        `Delete version ${number}?`,
                        "The current file isn’t affected. This can’t be undone.",
                        "Delete version",
                      ).then((confirmed) => {
                        if (!confirmed) return;
                        void run(
                          mutations.deleteVersion.mutateAsync({
                            documentId: document.id,
                            versionId,
                          }),
                          `Deleted version ${number}.`,
                          "Couldn’t delete that version.",
                        );
                      });
                    }}
                  />
                  <Renewals detail={detail} />
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {renewing ? (
        <RenewDialog
          title={document.title}
          currentExpiry={document.expiry_date ? formatCalendarDate(document.expiry_date) : null}
          onClose={() => setRenewing(false)}
          onSubmit={async ({ expiryDate, issueDate, note }) => {
            await mutations.renew.mutateAsync({
              documentId: document.id,
              body: issueDate
                ? { expiry_date: expiryDate, issue_date: issueDate, note }
                : { expiry_date: expiryDate, note },
            });
            onAnnounce(
              "Renewal recorded. Upload the renewed copy as a new version if you have it.",
            );
          }}
        />
      ) : null}
      {linking ? (
        <LinkRecordDialog
          workspaceId={workspaceId}
          linked={new Set(detail.links.map((link) => `${link.kind}:${link.id}`))}
          onClose={() => setLinking(false)}
          onLink={(kind, id) => mutations.link.mutateAsync({ documentId: document.id, kind, id })}
        />
      ) : null}
    </article>
  );
}

function SettingsTabs({
  tab,
  idPrefix,
  onChange,
}: {
  tab: SettingsTab;
  idPrefix: string;
  onChange: (tab: SettingsTab) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = SETTINGS_TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const target = next === null ? undefined : SETTINGS_TABS[next];
    if (next === null || !target) return;
    event.preventDefault();
    onChange(target.id);
    tabs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Document details"
      className="scrollbar-none flex min-w-0 gap-0.5 overflow-x-auto"
    >
      {SETTINGS_TABS.map(({ id, label, icon: Icon }, index) => {
        const selected = id === tab;
        return (
          <button
            key={id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-brand-subtle text-brand"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Organize({
  document,
  folders,
  categories,
  readOnly,
  onChange,
}: {
  document: DocumentRecord;
  folders: readonly DocumentFolder[];
  categories: readonly DocumentCategory[];
  readOnly: boolean;
  onChange: (
    changes: { folder_id?: string | null; category_id?: string | null; tags?: string[] },
    done: string,
  ) => void;
}) {
  const folderId = useId();
  const categoryId = useId();
  const tagId = useId();
  const [tag, setTag] = useState("");
  const addTag = () => {
    const name = tag.replace(/\s+/g, " ").trim().slice(0, 50);
    if (!name) return;
    setTag("");
    if (document.tags.some((existing) => existing.toLocaleLowerCase() === name.toLocaleLowerCase()))
      return;
    onChange({ tags: [...document.tags, name] }, `Tagged “${name}”.`);
  };
  return (
    <Section title="Organize">
      <div className="grid gap-3 @md/pane:grid-cols-2 @4xl/pane:grid-cols-1">
        <div className="space-y-1.5">
          <label htmlFor={categoryId} className="text-sm font-medium">
            Category
          </label>
          <Select
            id={categoryId}
            value={toChoice(document.category_id)}
            disabled={readOnly}
            options={categoryChoices(categories)}
            onValueChange={(value) =>
              onChange({ category_id: fromChoice(value) }, "Category changed.")
            }
            className="w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={folderId} className="text-sm font-medium">
            Folder
          </label>
          <Select
            id={folderId}
            value={toChoice(document.folder_id)}
            disabled={readOnly}
            options={folderChoices(folders, "Unfiled")}
            onValueChange={(value) => onChange({ folder_id: fromChoice(value) }, "Moved.")}
            className="w-full"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={tagId} className="text-sm font-medium">
          Tags
        </label>
        {document.tags.length > 0 ? (
          <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
            {document.tags.map((name) => (
              <li
                key={name}
                className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2 text-xs"
              >
                #{name}
                {!readOnly ? (
                  <button
                    type="button"
                    aria-label={`Remove tag “${name}”`}
                    className="rounded-full p-0.5 outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      onChange(
                        { tags: document.tags.filter((item) => item !== name) },
                        `Removed “${name}”.`,
                      )
                    }
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {!readOnly && document.tags.length < 20 ? (
          <div className="flex gap-2">
            <Input
              id={tagId}
              value={tag}
              maxLength={50}
              placeholder="Add a tag"
              autoComplete="off"
              onChange={(event) => setTag(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
            <Button variant="outline" onClick={addTag} disabled={!tag.trim()}>
              Add
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * The details and the reminder dates are one form, saved together; the tab picks which half
 * shows. Both halves stay mounted, so edits in one survive a look at the other.
 */
function DetailsForm({
  document,
  readOnly,
  tab,
  nextReminderAt,
  onSave,
}: {
  document: DocumentRecord;
  readOnly: boolean;
  tab: SettingsTab;
  nextReminderAt: string | null;
  /** Resolves with the saved document, which the form then shows as its new baseline. */
  onSave: (values: DocumentDetailsValues) => Promise<DocumentRecord>;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<DocumentDetailsValues>({
    resolver: yupResolver(documentDetailsSchema),
    defaultValues: detailsValues(document),
  });
  const extra = useFieldArray({ control, name: "custom_fields" });
  const currency = useWatch({ control, name: "currency" });
  const reminderDays = useWatch({ control, name: "reminder_days" });
  const id = useId();

  const save = async (values: DocumentDetailsValues) => {
    try {
      reset(detailsValues(await onSave(values)));
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the details.") });
    }
  };

  const toggleDay = (day: number) => {
    const next = reminderDays.includes(day)
      ? reminderDays.filter((item) => item !== day)
      : [...reminderDays, day];
    setValue("reminder_days", next, { shouldDirty: true });
  };

  return (
    <form
      noValidate
      hidden={tab !== "details" && tab !== "reminders"}
      onSubmit={(event) => void handleSubmit(save)(event)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <fieldset
        disabled={readOnly || isSubmitting}
        className="min-h-0 flex-1 scrollbar-thin overflow-y-auto p-4"
      >
        <div hidden={tab !== "details"} className="space-y-4">
          <Section title="Details">
            <FormField
              label="Name"
              autoComplete="off"
              {...register("title")}
              error={errors.title?.message}
            />
            <div className="space-y-1.5">
              <label htmlFor={`${id}-description`} className="text-sm font-medium">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea id={`${id}-description`} rows={2} {...register("description")} />
            </div>
            <div className="grid gap-3 @md/pane:grid-cols-2 @4xl/pane:grid-cols-1">
              <FormField
                label="Document number"
                hint="Kept off lists, search, and reminders."
                autoComplete="off"
                {...register("reference_number")}
                error={errors.reference_number?.message}
              />
              <FormField
                label="Issued by"
                autoComplete="off"
                {...register("issuing_authority")}
                error={errors.issuing_authority?.message}
              />
              <FormField
                label="Provider or organization"
                autoComplete="off"
                {...register("provider")}
                error={errors.provider?.message}
              />
              <DateField
                control={control}
                name="issue_date"
                label="Issue date"
                clearable
                placeholder="None"
              />
              <DateField
                control={control}
                name="effective_date"
                label="Effective date"
                clearable
                placeholder="None"
              />
              <SelectField
                control={control}
                name="currency"
                label="Currency"
                options={CURRENCY_OPTIONS}
              />
              <AmountField
                control={control}
                name="amount"
                label="Amount"
                currency={currency}
                placeholder="None"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-notes`} className="text-sm font-medium">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea id={`${id}-notes`} rows={3} {...register("notes")} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">More details</legend>
              {extra.fields.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add anything else worth keeping, like a policy type or a seat number.
                </p>
              ) : null}
              {extra.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <Input
                    aria-label={`Detail ${index + 1} name`}
                    placeholder="Name"
                    className="w-2/5"
                    {...register(`custom_fields.${index}.label`)}
                    aria-invalid={errors.custom_fields?.[index]?.label ? true : undefined}
                  />
                  <Input
                    aria-label={`Detail ${index + 1} value`}
                    placeholder="Value"
                    {...register(`custom_fields.${index}.value`)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label={`Remove detail ${index + 1}`}
                    onClick={() => extra.remove(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {extra.fields.length < 20 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => extra.append({ label: "", value: "" })}
                >
                  <Plus aria-hidden="true" />
                  Add a detail
                </Button>
              ) : null}
            </fieldset>
          </Section>
        </div>

        <div hidden={tab !== "reminders"} className="space-y-4">
          <Section title="Expiry and reminders">
            <div className="grid gap-3 @md/pane:grid-cols-2 @4xl/pane:grid-cols-1">
              <DateField
                control={control}
                name="expiry_date"
                label="Expiry date"
                clearable
                placeholder="Doesn’t expire"
              />
              <DateField
                control={control}
                name="renewal_date"
                label="Renewal date"
                clearable
                placeholder="None"
              />
              <DateField
                control={control}
                name="review_date"
                label="Review date"
                hint="For documents to look over now and then."
                clearable
                placeholder="None"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Remind me</legend>
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_DAY_CHOICES.map((day) => {
                  const on = reminderDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && reminderDays.length >= 6}
                      onClick={() => toggleDay(day)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                        on ? "border-brand/40 bg-brand-subtle text-brand" : "hover:bg-accent",
                      )}
                    >
                      {reminderDayLabel(day)}
                    </button>
                  );
                })}
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <BellRing className="size-3.5 shrink-0" aria-hidden="true" />
                {reminderDays.length === 0
                  ? "No reminders."
                  : nextReminderAt
                    ? `Next reminder ${dateTimeFormat.format(new Date(nextReminderAt))}, in Reminders and notifications.`
                    : document.state !== "active"
                      ? "Reminders are paused while it’s archived or in the Trash."
                      : "No reminder is coming up for these dates."}
              </p>
            </fieldset>
          </Section>
        </div>
      </fieldset>
      {!readOnly ? (
        <div className="space-y-3 border-t bg-card px-4 py-3">
          <FormAlert message={errors.root?.server?.message ?? null} />
          <div className="flex items-center justify-end gap-3">
            {isDirty ? (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            ) : null}
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save details"}
            </Button>
          </div>
        </div>
      ) : (
        <FormAlert message={errors.root?.server?.message ?? null} />
      )}
    </form>
  );
}

function Versions({
  detail,
  readOnly,
  onDownload,
  onRestore,
  onDelete,
}: {
  detail: DocumentDetail;
  readOnly: boolean;
  onDownload: (versionId: string) => void;
  onRestore: (versionId: string, number: number) => void;
  onDelete: (versionId: string, number: number) => void;
}) {
  if (detail.versions.length === 0) return null;
  return (
    <Section title="Version history">
      <ol className="divide-y rounded-xl border bg-card">
        {detail.versions.map((version) => (
          <li
            key={version.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
          >
            <span className="w-10 shrink-0 text-xs font-semibold text-muted-foreground">
              v{version.number}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{version.filename}</span>
              <span className="block text-xs text-muted-foreground">
                {dateTimeFormat.format(new Date(version.uploaded_at))} ·{" "}
                {formatFileSize(version.size_bytes)}
                {version.restored_from ? ` · restored from v${version.restored_from}` : ""}
                {version.note ? ` · ${version.note}` : ""}
              </span>
            </span>
            {version.is_current ? (
              <span className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-brand">
                Current
              </span>
            ) : null}
            <Menu
              aria-label={`Actions for version ${version.number}`}
              variant="ghost"
              size="icon"
              chevron={false}
              align="end"
              className="size-8"
              items={[
                {
                  id: "download",
                  label: "Download",
                  icon: Download,
                  onSelect: () => onDownload(version.id),
                },
                ...(!version.is_current && !readOnly
                  ? [
                      {
                        id: "restore",
                        label: "Make current",
                        onSelect: () => onRestore(version.id, version.number),
                      },
                      {
                        id: "delete",
                        label: "Delete version…",
                        destructive: true,
                        onSelect: () => onDelete(version.id, version.number),
                      },
                    ]
                  : []),
              ]}
            >
              <MoreHorizontal aria-hidden="true" />
            </Menu>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Links({
  detail,
  readOnly,
  onLink,
  onUnlink,
}: {
  detail: DocumentDetail;
  readOnly: boolean;
  onLink: () => void;
  onUnlink: (kind: DocumentLinkKind, id: string, title: string) => void;
}) {
  return (
    <Section
      title="Linked records"
      action={
        !readOnly ? (
          <Button variant="ghost" size="sm" onClick={onLink}>
            <Link2 aria-hidden="true" />
            Link
          </Button>
        ) : null
      }
    >
      {detail.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Link this document to a task, note, event, loan, policy, or transaction it belongs with.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {detail.links.map((link) => {
            const Icon = LINK_ICONS[link.kind];
            return (
              <li
                key={`${link.kind}:${link.id}`}
                className="flex items-center gap-3 px-4 py-2 text-sm"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <Link
                  href={linkedRecordHref(link)}
                  className="min-w-0 flex-1 rounded-sm outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block truncate font-medium">{link.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {linkKindLabel(link.kind)}
                    {link.detail ? ` · ${link.detail}` : ""}
                  </span>
                </Link>
                {!readOnly ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label={`Unlink “${link.title}”`}
                    onClick={() => onUnlink(link.kind, link.id, link.title)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Renewals({ detail }: { detail: DocumentDetail }) {
  if (detail.renewals.length === 0) return null;
  const date = (value: string | null) => (value ? formatCalendarDate(value) : "none");
  return (
    <Section title="Renewal history">
      <ol className="space-y-2">
        {detail.renewals.map((renewal) => (
          <li key={renewal.id} className="rounded-lg border bg-card px-4 py-2.5 text-sm">
            <p className="font-medium">
              Renewed {dateTimeFormat.format(new Date(renewal.renewed_at))}
            </p>
            <p className="text-xs text-muted-foreground">
              Expiry {date(renewal.previous_expiry_date)} → {date(renewal.expiry_date)}
              {renewal.previous_issue_date !== renewal.issue_date
                ? ` · issued ${date(renewal.previous_issue_date)} → ${date(renewal.issue_date)}`
                : ""}
            </p>
            {renewal.note ? <p className="mt-1 text-xs">{renewal.note}</p> : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}
