import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { createQueryClient } from "@/api/query-client";

/** Render `ui` with an empty query cache that doesn't retry, for components tested on their own. */
export function renderWithQueries(ui: ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient({ retry: false })}>{ui}</QueryClientProvider>,
  );
}
