"use client";

import type { UpdateVoiceSettingsRequest, VoiceOptionList, VoiceSettings } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { aiKeys } from "@/api/ai";
import {
  clearVoiceHistory,
  providerVoicesOptions,
  testVoice,
  updateVoiceSettings,
  voiceKeys,
  voiceSettingsOptions,
} from "@/api/voice";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import {
  defaultVoiceDevicePreference,
  readVoiceDevicePreference,
  subscribeVoiceDevicePreference,
  type VoiceDevicePreference,
  writeVoiceDevicePreference,
} from "@/lib/voice";
import { useAuth } from "@/providers/auth";

export function useVoiceSettings(): Resource<VoiceSettings> {
  const { withToken } = useAuth();
  return queryResource(useQuery(voiceSettingsOptions(withToken)), "Couldn’t load voice settings.");
}

export function useUpdateVoiceSettings() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateVoiceSettingsRequest) =>
      withToken((token) => updateVoiceSettings(token, body)),
    onSuccess: (settings) => queryClient.setQueryData(voiceKeys.settings(), settings),
  });
}

export function useProviderVoices(providerId: string | null): Resource<VoiceOptionList> {
  const { withToken } = useAuth();
  return queryResource(
    useQuery(providerVoicesOptions(withToken, providerId)),
    "Couldn’t list voices.",
  );
}

export function useTestVoice() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  return useMutation({
    mutationFn: () => withToken((token) => testVoice(token, workspaceId ?? "")),
  });
}

/** Delete spoken conversations in the active workspace (typed-only ones stay). */
export function useClearVoiceHistory() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => withToken((token) => clearVoiceHistory(token, workspaceId ?? "")),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) }),
  });
}

/** This browser's microphone, speaker, volume, and browser voice. */
export function useVoiceDevicePreference(): [
  VoiceDevicePreference,
  (change: Partial<VoiceDevicePreference>) => void,
] {
  const preference = useSyncExternalStore(
    subscribeVoiceDevicePreference,
    readVoiceDevicePreference,
    () => defaultVoiceDevicePreference,
  );
  return [preference, writeVoiceDevicePreference];
}
