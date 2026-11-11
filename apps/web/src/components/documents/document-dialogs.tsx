"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  DocumentCategory,
  DocumentCategoryIcon,
  DocumentFolder,
  DocumentFolderDeleteMode,
  DocumentLinkKind,
} from "@orbit/contracts";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDocumentList, useLinkCandidates } from "@/hooks/use-documents";
import { categorySchema, LINK_KINDS, newDocumentSchema, renewSchema } from "@/lib/documents";
import { cn } from "@/utils/common";
import { buildFolderTree, flattenFolders, folderSubtree } from "@/utils/folders";

import { CATEGORY_ICONS, FileIcon, LINK_ICONS } from "./document-meta";

const NONE = "none";

export function folderChoices(folders: readonly DocumentFolder[], none: string, exclude?: string) {
  const hidden = exclude ? folderSubtree(folders, exclude) : new Set<string>();
  return [
    { value: NONE, label: none },
    ...flattenFolders(buildFolderTree(folders))
      .filter(({ folder }) => !hidden.has(folder.id))
      .map(({ folder, depth }) => ({
        value: folder.id,
        label: `${" ".repeat(depth)}${folder.name}`,
      })),
  ];
}

export function categoryChoices(categories: readonly DocumentCategory[]) {
  return [
    { value: NONE, label: "No category" },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];
}

export const fromChoice = (value: string) => (value === NONE ? null : value);
export const toChoice = (value: string | null) => value ?? NONE;

/** Track a document without uploading it, such as a passport kept in a drawer. */
export function NewDocumentDialog({
  folders,
  categories,
  initialFolderId,
  initialCategoryId,
  onSubmit,
  onClose,
}: {
  folders: readonly DocumentFolder[];
  categories: readonly DocumentCategory[];
  initialFolderId: string | null;
  initialCategoryId: string | null;
  onSubmit: (values: {
    title: string;
    folderId: string | null;
    categoryId: string | null;
    expiryDate: string | null;
  }) => Promise<unknown>;
  onClose: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(newDocumentSchema),
    defaultValues: {
      title: "",
      folderId: toChoice(initialFolderId),
      categoryId: toChoice(initialCategoryId),
      expiryDate: "",
    },
  });
  const save = (close: () => void) => async (values: InferType<typeof newDocumentSchema>) => {
    try {
      await onSubmit({
        title: values.title,
        folderId: fromChoice(values.folderId),
        categoryId: fromChoice(values.categoryId),
        expiryDate: values.expiryDate || null,
      });
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t create it.") });
    }
  };
  return (
    <DialogShell
      title="New record without a file"
      description="Track a document you haven’t scanned yet. You can upload its file later."
      busy={isSubmitting}
      submitLabel="Create"
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit(save(close))(event)}
    >
      <FormField
        label="Name"
        autoFocus
        autoComplete="off"
        {...register("title")}
        error={errors.title?.message}
      />
      <SelectField
        control={control}
        name="categoryId"
        label="Category"
        options={categoryChoices(categories)}
      />
      <SelectField
        control={control}
        name="folderId"
        label="Folder"
        options={folderChoices(folders, "Unfiled")}
      />
      <DateField
        control={control}
        name="expiryDate"
        label="Expiry date"
        clearable
        placeholder="None"
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

const ICON_CHOICES: readonly { value: DocumentCategoryIcon; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "id-card", label: "ID card" },
  { value: "briefcase", label: "Briefcase" },
  { value: "wallet", label: "Wallet" },
  { value: "receipt", label: "Receipt" },
  { value: "landmark", label: "Bank" },
  { value: "shield", label: "Shield" },
  { value: "car", label: "Car" },
  { value: "home", label: "Home" },
  { value: "heart-pulse", label: "Health" },
  { value: "graduation-cap", label: "Education" },
  { value: "file-text", label: "Document" },
  { value: "plane", label: "Travel" },
  { value: "badge-check", label: "Certificate" },
];

function isIcon(value: string): value is DocumentCategoryIcon {
  return ICON_CHOICES.some((choice) => choice.value === value);
}

export function CategoryDialog({
  category,
  onSubmit,
  onClose,
}: {
  category: DocumentCategory | null;
  onSubmit: (values: { name: string; icon: DocumentCategoryIcon }) => Promise<unknown>;
  onClose: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(categorySchema),
    defaultValues: { name: category?.name ?? "", icon: category?.icon ?? "folder" },
  });
  const icon = useWatch({ control, name: "icon" });
  const Icon = isIcon(icon) ? CATEGORY_ICONS[icon] : CATEGORY_ICONS.folder;
  const save = (close: () => void) => async (values: InferType<typeof categorySchema>) => {
    try {
      await onSubmit({ name: values.name, icon: isIcon(values.icon) ? values.icon : "folder" });
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the category.") });
    }
  };
  return (
    <DialogShell
      title={category ? "Edit category" : "New category"}
      busy={isSubmitting}
      submitLabel={category ? "Save" : "Create category"}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit(save(close))(event)}
    >
      <FormField
        label="Name"
        autoFocus
        autoComplete="off"
        maxLength={50}
        {...register("name")}
        error={errors.name?.message}
      />
      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <SelectField control={control} name="icon" label="Icon" options={ICON_CHOICES} />
        </div>
        <span className="mb-0.5 flex size-9 items-center justify-center rounded-lg bg-brand-subtle text-brand">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

/** Record a renewal. The old dates are kept in the document's renewal history. */
export function RenewDialog({
  title,
  currentExpiry,
  onSubmit,
  onClose,
}: {
  title: string;
  currentExpiry: string | null;
  onSubmit: (values: {
    expiryDate: string | null;
    issueDate: string | null;
    note: string;
  }) => Promise<unknown>;
  onClose: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(renewSchema),
    defaultValues: { expiryDate: "", issueDate: "", note: "" },
  });
  const save = (close: () => void) => async (values: InferType<typeof renewSchema>) => {
    try {
      await onSubmit({
        expiryDate: values.expiryDate || null,
        issueDate: values.issueDate || null,
        note: values.note,
      });
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t record the renewal."),
      });
    }
  };
  return (
    <DialogShell
      title={`Renew “${title}”`}
      description={
        currentExpiry
          ? `It expires on ${currentExpiry}. The old dates stay in its history, and reminders move to the new ones.`
          : "The old dates stay in its history, and reminders move to the new ones."
      }
      busy={isSubmitting}
      submitLabel="Record renewal"
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit(save(close))(event)}
    >
      <DateField
        control={control}
        name="expiryDate"
        label="New expiry date"
        clearable
        placeholder="No expiry"
      />
      <DateField
        control={control}
        name="issueDate"
        label="New issue date"
        hint="Leave empty to keep the current one."
        clearable
        placeholder="Keep current"
      />
      <FormField
        label="Note"
        autoComplete="off"
        maxLength={500}
        {...register("note")}
        error={errors.note?.message}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

const FOLDER_DELETE_CHOICES: readonly {
  value: DocumentFolderDeleteMode;
  label: string;
  description: string;
}[] = [
  {
    value: "parent",
    label: "Move its contents up a level",
    description: "Documents and subfolders move to the parent folder (or the top level).",
  },
  {
    value: "unfiled",
    label: "Leave its documents unfiled",
    description: "Subfolders are deleted too; every document inside stays, without a folder.",
  },
  {
    value: "folder",
    label: "Move its documents to another folder",
    description: "Subfolders are deleted too; every document inside moves to the folder you pick.",
  },
];

/** Deleting a folder never deletes documents: the user chooses where they go. */
export function DeleteDocumentFolderDialog({
  folder,
  folders,
  documentCount,
  onSubmit,
  onClose,
}: {
  folder: DocumentFolder;
  folders: readonly DocumentFolder[];
  documentCount: number;
  onSubmit: (mode: DocumentFolderDeleteMode, targetId: string | null) => Promise<unknown>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<DocumentFolderDeleteMode>("parent");
  const targets = folderChoices(folders, "", folder.id).filter((choice) => choice.value !== NONE);
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = useId();
  const targetId = useId();
  return (
    <DialogShell
      title={`Delete “${folder.name}”?`}
      description={
        documentCount === 0
          ? "The folder is empty."
          : `It holds ${documentCount} ${documentCount === 1 ? "document" : "documents"}, counting subfolders. None are deleted.`
      }
      busy={busy}
      submitLabel="Delete folder"
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        if (mode === "folder" && !target) {
          setError("Create another folder to move the documents to, or choose another option.");
          return;
        }
        setBusy(true);
        setError(null);
        onSubmit(mode, mode === "folder" ? target : null).then(
          () => {
            setBusy(false);
            close();
          },
          (reason: unknown) => {
            setBusy(false);
            setError(describeApiError(reason, "Couldn’t delete the folder."));
          },
        );
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">What happens to what’s inside?</legend>
        {FOLDER_DELETE_CHOICES.map((choice) => (
          <label
            key={choice.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
              mode === choice.value ? "border-brand/50 bg-brand-subtle/50" : "hover:bg-accent/40",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={mode === choice.value}
              onChange={() => setMode(choice.value)}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-sm font-medium">{choice.label}</span>
              <span className="block text-xs text-muted-foreground">{choice.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "folder" ? (
        <div className="space-y-1.5">
          <label htmlFor={targetId} className="text-sm font-medium">
            Move them to
          </label>
          <Select
            id={targetId}
            value={target}
            onValueChange={setTarget}
            options={targets}
            placeholder="No other folders"
            className="w-full"
          />
        </div>
      ) : null}
      <FormAlert message={error} />
    </DialogShell>
  );
}

/** Pick a record elsewhere in Orbit to link a document to. */
export function LinkRecordDialog({
  workspaceId,
  linked,
  onLink,
  onClose,
}: {
  workspaceId: string;
  /** Already linked, as `kind:id`. */
  linked: ReadonlySet<string>;
  onLink: (kind: DocumentLinkKind, id: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<DocumentLinkKind>("task");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kindId = useId();
  const searchId = useId();
  const candidates = useLinkCandidates(workspaceId, kind, search.trim(), true);
  const Icon = LINK_ICONS[kind];
  return (
    <DialogShell
      title="Link to a record"
      description="Tasks, notes, events, and finance records in this workspace."
      busy={busy}
      submitLabel="Done"
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <label htmlFor={kindId} className="text-sm font-medium">
            Kind
          </label>
          <Select
            id={kindId}
            value={kind}
            onValueChange={(value) => setKind(value)}
            options={LINK_KINDS.map((item) => ({ value: item.kind, label: item.plural }))}
            className="w-full"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={searchId} className="text-sm font-medium">
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              autoComplete="off"
              className="pl-8"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </div>
      <div aria-live="polite" className="max-h-72 overflow-y-auto">
        {candidates.status === "loading" ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : candidates.status === "error" ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            {candidates.message}
          </p>
        ) : candidates.data.records.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing found.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {candidates.data.records.map((record) => {
              const already = linked.has(`${record.kind}:${record.id}`);
              return (
                <li key={record.id}>
                  <button
                    type="button"
                    disabled={already || busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      onLink(record.kind, record.id).then(
                        () => setBusy(false),
                        (reason: unknown) => {
                          setBusy(false);
                          setError(describeApiError(reason, "Couldn’t link it."));
                        },
                      );
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:opacity-60"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{record.title}</span>
                      {record.detail ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {record.detail}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {already ? "Linked" : "Link"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <FormAlert message={error} />
    </DialogShell>
  );
}

/** Pick documents to link from another module (a note, a task, an event, a loan). */
export function DocumentPickerDialog({
  workspaceId,
  linked,
  onPick,
  onClose,
}: {
  workspaceId: string;
  linked: ReadonlySet<string>;
  onPick: (documentId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const { state } = useDocumentList(workspaceId, {
    q: search.trim() || undefined,
    sort: search.trim() ? "title" : "updated",
    limit: 20,
  });
  return (
    <DialogShell
      title="Link a document"
      description="Documents from your vault. Nothing is copied."
      busy={busy}
      submitLabel="Done"
      onClose={onClose}
      onSubmit={(event, close) => {
        event.preventDefault();
        // React bubbles submits through portals; keep the host's form from submitting too.
        event.stopPropagation();
        close();
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">
          Search documents
        </label>
        <Input
          id={searchId}
          type="search"
          autoFocus
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div aria-live="polite" className="max-h-72 overflow-y-auto">
        {state.status === "loading" ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : state.status === "error" ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            {state.message}
          </p>
        ) : state.data.documents.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search.trim() ? "No documents match." : "No documents yet. Upload some in Documents."}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {state.data.documents.map((document) => {
              const already = linked.has(document.id);
              return (
                <li key={document.id}>
                  <button
                    type="button"
                    disabled={already || busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      onPick(document.id).then(
                        () => setBusy(false),
                        (reason: unknown) => {
                          setBusy(false);
                          setError(describeApiError(reason, "Couldn’t link the document."));
                        },
                      );
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default disabled:opacity-60"
                  >
                    <FileIcon file={document.file} className="size-8" />
                    <span className="min-w-0 flex-1 truncate font-medium">{document.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {already ? "Linked" : "Link"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <FormAlert message={error} />
    </DialogShell>
  );
}
