import type {
  PushStatus,
  PushSubscriptionRequest,
  PushTestResult,
  UpdatePushPreferencesRequest,
} from "@orbit/contracts";

import { request, type Signal } from "../client";

const PUSH = "/api/v1/me/push";

export function getPushStatus(token: string, { signal }: Signal = {}): Promise<PushStatus> {
  return request<PushStatus>(PUSH, { token, signal });
}

export function updatePushPreferences(
  token: string,
  body: UpdatePushPreferencesRequest,
): Promise<PushStatus> {
  return request<PushStatus>(`${PUSH}/preferences`, { method: "PUT", body, token });
}

export function savePushSubscription(
  token: string,
  body: PushSubscriptionRequest,
): Promise<PushStatus> {
  return request<PushStatus>(`${PUSH}/subscriptions`, { method: "PUT", body, token });
}

export function removePushSubscription(token: string, endpoint: string): Promise<PushStatus> {
  return request<PushStatus>(`${PUSH}/subscriptions/remove`, {
    method: "POST",
    body: { endpoint },
    token,
  });
}

export function sendPushTest(token: string): Promise<PushTestResult> {
  return request<PushTestResult>(`${PUSH}/test`, { method: "POST", token });
}
