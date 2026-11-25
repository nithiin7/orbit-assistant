"use client";

import type { ImportStatementRequest, StatementPreviewQuery } from "@orbit/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { financeKeys, importStatement, previewStatement, undoStatementImport } from "@/api/finance";
import { encodePassword } from "@/lib/finance";
import { useAuth } from "@/providers/auth";

/**
 * Previewing a bank statement (nothing is saved), importing the reviewed rows, and undoing an
 * import. Importing and undoing refresh every finance view, since balances, budgets, and
 * payments can all change.
 */
export function useStatementImport(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refetchFinance = () =>
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });

  const preview = (file: Blob, query: StatementPreviewQuery, password?: string) =>
    withToken((token) =>
      previewStatement(
        token,
        workspaceId,
        file,
        query,
        password ? encodePassword(password) : undefined,
      ),
    );

  const importRows = useMutation({
    mutationFn: (body: ImportStatementRequest) =>
      withToken((token) => importStatement(token, workspaceId, body)),
    onSuccess: refetchFinance,
  });

  const undo = useMutation({
    mutationFn: (batchId: string) =>
      withToken((token) => undoStatementImport(token, workspaceId, batchId)),
    onSuccess: refetchFinance,
  });

  return { preview, importRows, undo };
}
