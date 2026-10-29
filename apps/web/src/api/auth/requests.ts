import type {
  AuthConfig,
  LocalSessionResponse,
  LocalSignInRequest,
  LocalSignUpRequest,
} from "@orbit/contracts";

import { request, type Signal } from "../client";

/** How to sign in: local accounts or Supabase Auth, decided by the API's storage mode. */
export function getAuthConfig({ signal }: Signal = {}): Promise<AuthConfig> {
  return request<AuthConfig>("/api/v1/auth/config", { signal });
}

export function localSignUp(body: LocalSignUpRequest): Promise<LocalSessionResponse> {
  return request<LocalSessionResponse>("/api/v1/auth/local/sign-up", { method: "POST", body });
}

export function localSignIn(body: LocalSignInRequest): Promise<LocalSessionResponse> {
  return request<LocalSessionResponse>("/api/v1/auth/local/sign-in", { method: "POST", body });
}

export function localSignOut(token: string): Promise<void> {
  return request<void>("/api/v1/auth/local/sign-out", { method: "POST", token });
}
