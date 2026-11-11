"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { deleteMyCover, getMyCover, profileKeys, putMyCover } from "@/api/profile";
import { prepareCover, readAsDataUrl } from "@/lib/avatar";
import { useAuth } from "@/providers/auth";

/**
 * The signed-in user's profile cover photo as a `data:` URL (the API needs a bearer token, so a
 * plain `src` can't load it), with upload and remove. A missing or failed cover is cosmetic:
 * `url` stays null and the profile banner shows instead.
 */
export function useProfileCover() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  const cover = useQuery({
    queryKey: profileKeys.cover(),
    queryFn: async ({ signal }) => {
      const blob = await withToken((token) => getMyCover(token, { signal }));
      return blob ? readAsDataUrl(blob) : null;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const image = await prepareCover(file);
      await withToken((token) => putMyCover(token, image));
      return readAsDataUrl(image);
    },
    onSuccess: (url) => queryClient.setQueryData(profileKeys.cover(), url),
  });

  const remove = useMutation({
    mutationFn: () => withToken((token) => deleteMyCover(token)),
    onSuccess: () => queryClient.setQueryData(profileKeys.cover(), null),
  });

  return {
    url: cover.data ?? null,
    busy: upload.isPending || remove.isPending,
    /** Resize and upload a photo. Rejects with `AvatarImageError` or `ApiError`. */
    upload: upload.mutateAsync,
    remove: remove.mutateAsync,
  };
}
