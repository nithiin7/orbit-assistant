"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { deleteMyAvatar, getMyAvatar, putMyAvatar } from "@/api/profile";
import { useAuth, useCurrentUser } from "@/components/auth/auth-provider";
import { prepareAvatar } from "@/lib/avatar";

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
  const user = useCurrentUser();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    withToken((token) => getMyAvatar(token, { signal: controller.signal })).then(
      (blob) => {
        setUrl(blob ? URL.createObjectURL(blob) : null);
        setLoading(false);
      },
      () => {
        // A missing photo is cosmetic: fall back to the initial rather than showing an error.
        if (!controller.signal.aborted) setLoading(false);
      },
    );
    return () => controller.abort();
  }, [withToken, user.id]);

  // Release each object URL once it is replaced, and the last one on unmount.
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const upload = useCallback(
    async (file: File) => {
      const image = await prepareAvatar(file);
      await withToken((token) => putMyAvatar(token, image));
      setUrl(URL.createObjectURL(image));
    },
    [withToken],
  );

  const remove = useCallback(async () => {
    await withToken((token) => deleteMyAvatar(token));
    setUrl(null);
  }, [withToken]);

  const value = useMemo(() => ({ url, loading, upload, remove }), [url, loading, upload, remove]);

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}
