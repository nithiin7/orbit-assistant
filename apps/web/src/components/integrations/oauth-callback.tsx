"use client";

import { Plug } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { useCompleteAuthorization } from "@/hooks/use-integrations";
import { CALLBACK_PATH, connectionHref } from "@/lib/integrations";

/**
 * Where the provider sends the browser after consent. The code and state go to the API with
 * this person's session (the API checks the state is theirs, unused, and recent), then leave
 * the address bar and history at once.
 */
export function OAuthCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const complete = useCompleteAuthorization();
  // Read once: the address is cleared below, and a second completion would fail.
  const [received] = useState(() => ({
    state: params.get("state"),
    code: params.get("code"),
    error: params.get("error"),
  }));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, "", CALLBACK_PATH);
    if (!received.state) return;
    complete.mutate(
      { state: received.state, code: received.code, error: received.error },
      { onSuccess: (connection) => router.replace(connectionHref(connection.id)) },
    );
  }, [complete, received, router]);

  const failed = !received.state || complete.isError;
  if (!failed) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted-foreground">
        Finishing connecting your account…
      </p>
    );
  }
  return (
    <EmptyState
      icon={Plug}
      title="The account wasn’t connected"
      description={
        received.state
          ? describeApiError(complete.error, "Something went wrong while connecting.")
          : "This page is only reached from a provider’s sign-in. Start again from Settings."
      }
    >
      <Link
        href="/settings/integrations"
        className="text-sm font-medium text-brand hover:underline"
      >
        Back to Integrations
      </Link>
    </EmptyState>
  );
}
