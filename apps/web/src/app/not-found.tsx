import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";

/** Rendered outside the app shell, so it works whether or not anyone is signed in. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 pt-8 pb-16 sm:pt-16">
        <h1 className="sr-only">Page not found</h1>
        <EmptyState
          icon={Compass}
          title="Nothing at this address"
          description="The page you requested does not exist. Check the URL, or head back to Orbit."
        >
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Back to Orbit
          </Link>
        </EmptyState>
      </main>
    </div>
  );
}
