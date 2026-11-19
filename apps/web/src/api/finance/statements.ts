import type {
  ImportStatementRequest,
  ImportStatementResult,
  StatementPreview,
  StatementPreviewQuery,
  UndoStatementImportResult,
} from "@orbit/contracts";

import { request, toQueryString, workspacePath } from "../client";

function statementsPath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/finance/statements${suffix}`);
}

/**
 * Read a statement and propose what to do with each row; nothing is saved. A PDF's password
 * goes base64-encoded in a header, never in the URL, and the API never stores it.
 */
export function previewStatement(
  token: string,
  workspaceId: string,
  file: Blob,
  query: StatementPreviewQuery,
  encodedPassword?: string,
): Promise<StatementPreview> {
  return request<StatementPreview>(statementsPath(workspaceId, `/preview${toQueryString(query)}`), {
    method: "POST",
    body: file,
    token,
    headers: encodedPassword ? { "X-Statement-Password": encodedPassword } : undefined,
  });
}

export function importStatement(
  token: string,
  workspaceId: string,
  body: ImportStatementRequest,
): Promise<ImportStatementResult> {
  return request<ImportStatementResult>(statementsPath(workspaceId, "/imports"), {
    method: "POST",
    body,
    token,
  });
}

export function undoStatementImport(
  token: string,
  workspaceId: string,
  batchId: string,
): Promise<UndoStatementImportResult> {
  return request<UndoStatementImportResult>(
    statementsPath(workspaceId, `/imports/${encodeURIComponent(batchId)}`),
    { method: "DELETE", token },
  );
}
