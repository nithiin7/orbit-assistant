import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getVoiceSettings, listProviderVoices } from "./requests";

export const voiceKeys = {
  /** Per person, not per workspace. */
  me: () => ["me", "voice"] as const,
  settings: () => [...voiceKeys.me(), "settings"] as const,
  voices: (providerId: string) => [...voiceKeys.me(), "voices", providerId] as const,
};

export function voiceSettingsOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: voiceKeys.settings(),
    queryFn: ({ signal }) => withToken((token) => getVoiceSettings(token, { signal })),
  });
}

export function providerVoicesOptions(withToken: WithToken, providerId: string | null) {
  return queryOptions({
    queryKey: voiceKeys.voices(providerId ?? "none"),
    queryFn: providerId
      ? ({ signal }) => withToken((token) => listProviderVoices(token, providerId, { signal }))
      : skipToken,
    staleTime: 5 * 60_000,
  });
}
