const AUTH_ROUTES = new Set(["/sign-in", "/sign-up"]);

/**
 * The in-app path to return to after signing in. Anything that is not a same-origin path
 * (such as `//evil.example` or `https://…`) falls back to the dashboard, preventing open redirects.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  let url: URL;
  try {
    url = new URL(value, "http://orbit.invalid");
  } catch {
    return "/";
  }
  if (url.origin !== "http://orbit.invalid" || AUTH_ROUTES.has(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in URL that returns to `pathname` afterwards. */
export function signInPath(pathname: string): string {
  const next = safeNextPath(pathname);
  return next === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`;
}
