/**
 * Public (browser-visible) configuration. Only NEXT_PUBLIC_* variables belong here;
 * they are inlined into the client bundle at build time. Never add secrets.
 */

const DEFAULT_API_URL = "http://localhost:8000";

export function parseApiUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL must be an absolute URL, received "${raw}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`NEXT_PUBLIC_API_URL must use http or https, received "${url.protocol}".`);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export const publicEnv = {
  apiUrl: parseApiUrl(process.env.NEXT_PUBLIC_API_URL),
} as const;
