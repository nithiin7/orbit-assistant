"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { avatarOptions, deleteMyAvatar, profileKeys, putMyAvatar } from "@/api/profile";
import { prepareAvatar, readAsDataUrl } from "@/lib/avatar";
import { useAuth } from "@/providers/auth";

type AvatarContextValue = {
  /** A `data:` URL for the photo; `null` when none is set or it hasn't loaded. */
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
 * so the image is fetched as a blob and shown through a data URL rather than a plain `src`.
 */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  // A missing photo is cosmetic: on failure, `url` stays null and the initial shows instead.
  const photo = useQuery(avatarOptions(withToken));
  const blob = photo.data ?? null;
  const [read, setRead] = useState<{ blob: Blob; url: string } | null>(null);

  // A data URL rather than an object URL: an object URL revoked by an effect cleanup that re-runs
  // without a new render (Strict Mode, Fast Refresh, a remount) leaves a broken image on screen.
  useEffect(() => {
    if (!blob) return;
    let current = true;
    readAsDataUrl(blob).then(
      (dataUrl) => {
        if (current) setRead({ blob, url: dataUrl });
      },
      () => {
        // Unreadable: fall back to the initial, as for a failed download.
        if (current) setRead(null);
      },
    );
    return () => {
      current = false;
    };
  }, [blob]);
  const url = blob && read?.blob === blob ? read.url : null;

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
