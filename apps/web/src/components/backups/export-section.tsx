"use client";

import type { ExportFormat, ExportModuleInfo, ExportModuleRequest } from "@orbit/contracts";
import { Download, PackageOpen } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { ErrorText, Section } from "@/components/integrations/section";
import { Button } from "@/components/ui/button";
import { useExportArchive, useExportModule } from "@/hooks/use-backups";
import { formatLabel } from "@/lib/backups";

/** Download the workspace, or one module, in portable formats. Nothing is kept on the server. */
export function ExportSection({ modules }: { modules: ExportModuleInfo[] }) {
  const archive = useExportArchive();
  const exportModule = useExportModule();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, task: () => Promise<void>) {
    setError(null);
    setPending(key);
    try {
      await task();
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t prepare the export. Try again."));
    } finally {
      setPending(null);
    }
  }

  function moduleExport(body: ExportModuleRequest) {
    const key = `${body.module ?? "all"}:${body.format}`;
    return run(key, () => exportModule.mutateAsync(body));
  }

  return (
    <Section
      id="backup-export"
      icon={PackageOpen}
      title="Export"
      description="Take your data elsewhere. Exports are built for the download and not kept on the server."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="soft"
          disabled={pending !== null}
          onClick={() =>
            void run("archive", () => archive.mutateAsync({ include_files: true, password: null }))
          }
        >
          <Download aria-hidden="true" />
          {pending === "archive" ? "Preparing…" : "Workspace with files (.zip)"}
        </Button>
        <Button
          variant="ghost"
          disabled={pending !== null}
          onClick={() => void moduleExport({ module: null, format: "json" })}
        >
          {pending === "all:json" ? "Preparing…" : "All records (JSON)"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        The ZIP is a full backup you can restore. JSON exports can be imported into any workspace.
        Neither is encrypted; to download an encrypted copy, create a backup with a password and
        download it from the history.
      </p>
      <ErrorText message={error} />
      <ul className="divide-y overflow-hidden rounded-xl border">
        {modules.map((info) => (
          <li key={info.module} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-0 flex-1 text-sm">{info.label}</span>
            {info.formats.map((format: ExportFormat) => {
              const key = `${info.module}:${format}`;
              return (
                <Button
                  key={format}
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  aria-label={`Export ${info.label} as ${formatLabel(format)}`}
                  onClick={() => void moduleExport({ module: info.module, format })}
                >
                  {pending === key ? "Preparing…" : formatLabel(format)}
                </Button>
              );
            })}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Finance’s spreadsheet of transactions and the document vault’s original files have their own
        exports in Finance and Documents.
      </p>
    </Section>
  );
}
