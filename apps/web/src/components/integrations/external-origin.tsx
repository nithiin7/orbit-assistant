"use client";

import type { IntegrationEntityType } from "@orbit/contracts";
import { Link2 } from "lucide-react";
import Link from "next/link";

import { useOrigins } from "@/hooks/use-integrations";
import { capabilityName, connectionHref } from "@/lib/integrations";

/**
 * Where a record came from and whether Orbit changes go back: "From Google Calendar
 * (ada@gmail.com · Personal). Changes stay in Orbit." Renders nothing for Orbit-only records,
 * and nothing if the lookup fails (it's supplementary).
 */
export function ExternalOrigin({
  entityType,
  entityId,
}: {
  entityType: IntegrationEntityType;
  entityId: string;
}) {
  const origins = useOrigins(entityType, entityId);
  if (origins.status !== "success" || origins.data.origins.length === 0) return null;
  return (
    <ul className="space-y-1">
      {origins.data.origins.map((origin) => {
        const { link } = origin;
        const service =
          link.external_kind === "event"
            ? capabilityName(origin.provider, "calendar")
            : link.external_kind === "file"
              ? capabilityName(origin.provider, "files")
              : capabilityName(origin.provider, "mail");
        const where = [origin.account_email, origin.resource_name].filter(Boolean).join(" · ");
        const sync =
          link.external_kind === "message"
            ? null
            : link.status === "conflict"
              ? "Changed in both places; choose a version in Settings → Integrations."
              : link.status === "missing"
                ? "No longer available there."
                : link.status === "update_available"
                  ? "Changed there since it was imported."
                  : origin.two_way
                    ? "Changes sync both ways."
                    : "Changes made here stay in Orbit.";
        return (
          <li key={link.id} className="flex gap-2 text-xs text-muted-foreground">
            <Link2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {link.origin === "linked"
                ? "Made from an email in "
                : link.origin === "orbit"
                  ? "Also in "
                  : "From "}
              <Link
                href={connectionHref(link.connection_id)}
                className="font-medium text-foreground hover:underline"
              >
                {service}
              </Link>{" "}
              ({where}). {sync}
              {link.external_url ? (
                <>
                  {" "}
                  <a
                    href={link.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:underline"
                  >
                    Open there
                  </a>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
