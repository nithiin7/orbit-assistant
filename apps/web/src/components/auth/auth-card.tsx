import Link from "next/link";
import type { ReactNode } from "react";

import { OrbitMark } from "@/components/logo";

type AuthCardProps = {
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <div className="w-full animate-page-in space-y-6">
      <div className="rounded-2xl border bg-card/95 p-6 shadow-elevation-3 backdrop-blur-sm sm:p-8">
        <div className="mb-7 flex flex-col items-center gap-4 text-center">
          <Link
            href="/"
            aria-label="Orbit"
            className="flex size-12 items-center justify-center rounded-xl border bg-background shadow-elevation-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrbitMark className="size-7" />
          </Link>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
      </div>
      {footer ? <p className="text-center text-sm text-muted-foreground">{footer}</p> : null}
    </div>
  );
}

export const authLinkClassName =
  "rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";
