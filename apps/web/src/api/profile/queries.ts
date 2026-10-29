import { queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getMyAvatar } from "./requests";

/** Keys for the signed-in user's own data. The cache is cleared when the user changes. */
export const profileKeys = {
  avatar: () => ["me", "avatar"] as const,
};

/** The profile photo as a Blob, or `null` when none is set. */
export function avatarOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: profileKeys.avatar(),
    queryFn: ({ signal }) => withToken((token) => getMyAvatar(token, { signal })),
  });
}
