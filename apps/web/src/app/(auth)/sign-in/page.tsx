import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";
import { safeNextPath } from "@/lib/auth/redirect";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: PageProps<"/sign-in">) {
  const { next } = await props.searchParams;
  return <SignInForm next={safeNextPath(typeof next === "string" ? next : null)} />;
}
