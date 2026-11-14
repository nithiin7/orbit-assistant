import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Get a link to reset your Orbit password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
