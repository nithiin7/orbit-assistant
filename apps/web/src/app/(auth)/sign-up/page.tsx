import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your Orbit account and start organizing your life privately.",
};

export default function SignUpPage() {
  return <SignUpForm />;
}
