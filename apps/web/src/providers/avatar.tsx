"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";

import { avatarOptions, deleteMyAvatar, profileKeys, putMyAvatar } from "@/api/profile";
import { prepareAvatar } from "@/lib/avatar";
import { useAuth } from "@/providers/auth";

type AvatarContextValue = {
  /** An object URL for the photo; `null` when none is set or it hasn't loaded. */
  url: string | null;
  loading: boolean;
  /** Resize and upload a photo. Rejects with `AvatarImageError` or `ApiError`. */
  upload: (file: File) => Promise<void>;
  remove: () => Promise<void>;
};

const AvatarContext = createContext<AvatarContextValue | null>(null);

export function useAvatar(): AvatarContextValue {
  const context = useContext(AvatarContext);
  if (!context) throw new Error("useAvatar must be used within AvatarProvider.");
  return context;
}

/**
 * Loads the signed-in user's profile photo once and shares it. The API requires a bearer token,
 * so the image is fetched as a blob and shown through an object URL rather than a plain `src`.
 */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  // A missing photo is cosmetic: on failure, `url` stays null and the initial shows instead.
  const photo = useQuery(avatarOptions(withToken));
  const blob = photo.data ?? null;
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  // Release each object URL once it is replaced, and the last one on unmount.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const { mutateAsync: upload } = useMutation({
    mutationFn: async (file: File) => {
      const image = await prepareAvatar(file);
      await withToken((token) => putMyAvatar(token, image));
      return image;
    },
    onSuccess: (image) => queryClient.setQueryData(profileKeys.avatar(), image),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: () => withToken((token) => deleteMyAvatar(token)),
    onSuccess: () => queryClient.setQueryData(profileKeys.avatar(), null),
  });

  const loading = photo.isPending && photo.fetchStatus !== "idle";
  const value = useMemo(
    () => ({
      url,
      loading,
      upload: async (file: File) => void (await upload(file)),
      remove: () => remove(),
    }),
    [url, loading, upload, remove],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}
