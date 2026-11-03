/**
 * Response headers for every page of the web app, set in `next.config.ts` so they apply with or
 * without a reverse proxy in front.
 *
 * The Content-Security-Policy is deliberately partial: it forbids framing (clickjacking),
 * plugins, `<base>` rewriting, and posting forms elsewhere, without restricting scripts or
 * connections, which would need per-request nonces and the deployment's API and Supabase URLs.
 */
export interface Header {
  key: string;
  value: string;
}

export const contentSecurityPolicy = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const securityHeaders: readonly Header[] = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Orbit uses none of these; a script injected into a page couldn't either.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];
