import type {
  AppLockDeviceOptions,
  AppLockStatus,
  AppLockTimingRequest,
  DisableAppLockRequest,
  RegisterAppLockDeviceRequest,
  SetAppLockPinRequest,
  UnlockWithDeviceRequest,
  UnlockWithPinRequest,
} from "@orbit/contracts";

import { request, type Signal } from "../client";

const LOCK = "/api/v1/me/app-lock";

export function getAppLock(token: string, { signal }: Signal = {}): Promise<AppLockStatus> {
  return request<AppLockStatus>(LOCK, { token, signal });
}

export function setAppLockPin(token: string, body: SetAppLockPinRequest): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/pin`, { method: "PUT", body, token });
}

export function updateAppLockTiming(
  token: string,
  body: AppLockTimingRequest,
): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/timing`, { method: "PUT", body, token });
}

export function disableAppLock(token: string, body: DisableAppLockRequest): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/disable`, { method: "POST", body, token });
}

export function lockApp(token: string): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/lock`, { method: "POST", token });
}

export function recordAppLockActivity(token: string): Promise<void> {
  return request<void>(`${LOCK}/activity`, { method: "POST", token });
}

export function unlockWithPin(token: string, body: UnlockWithPinRequest): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/unlock`, { method: "POST", body, token });
}

export function getAppLockDeviceOptions(token: string): Promise<AppLockDeviceOptions> {
  return request<AppLockDeviceOptions>(`${LOCK}/devices/options`, { method: "POST", token });
}

export function addAppLockDevice(
  token: string,
  body: RegisterAppLockDeviceRequest,
): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/devices`, { method: "POST", body, token });
}

export function removeAppLockDevice(token: string, deviceId: string): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/devices/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    token,
  });
}

export function getUnlockOptions(token: string): Promise<AppLockDeviceOptions> {
  return request<AppLockDeviceOptions>(`${LOCK}/unlock/options`, { method: "POST", token });
}

export function unlockWithDevice(
  token: string,
  body: UnlockWithDeviceRequest,
): Promise<AppLockStatus> {
  return request<AppLockStatus>(`${LOCK}/unlock/device`, { method: "POST", body, token });
}
