import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Choose a new password for your Orbit account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
