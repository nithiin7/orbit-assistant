import type { UserProfile } from "@orbit/contracts";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { useAuth, useCurrentUser } from "@/providers/auth";

export type SetupStatus = UserProfile["setup_status"];

/** The signed-in user's progress through the setup guide, and a way to change it. */
export function useSetupStatus() {
  const { withToken, setUser } = useAuth();
  const user = useCurrentUser();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(setupStatus: SetupStatus): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      setUser(await withToken((token) => updateMe(token, { setup_status: setupStatus })));
      return true;
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t save your setup progress. Try again."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { status: user.setup_status, save, saving, error };
}
