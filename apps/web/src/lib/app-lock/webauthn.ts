/**
 * Touch ID and Windows Hello through WebAuthn. The API sends options as JSON with binary values
 * in base64url; the browser needs them as buffers, and its answers go back as JSON the same way.
 *
 * Only the device's built-in authenticator is used, with user verification: the fingerprint,
 * face, or device PIN is checked by the operating system and never reaches Orbit.
 */

import { isMacPlatform } from "@/utils/keyboard";

type Json = Record<string, unknown>;

/** Browser-side failures, worded for people. `cancelled` is not worth an error message. */
export class DeviceUnlockError extends Error {
  constructor(
    readonly reason: "cancelled" | "unsupported" | "already-added" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "DeviceUnlockError";
  }
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown): Json {
  if (!isJson(value)) throw malformed();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw malformed();
  return value;
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw malformed();
  return value;
}

function malformed(): DeviceUnlockError {
  return new DeviceUnlockError("failed", "Orbit sent options this browser can’t use.");
}

/** Credentials this device made; `internal` keeps the browser from offering phones or keys. */
function descriptors(value: unknown): PublicKeyCredentialDescriptor[] {
  return list(value).map((item) => ({
    type: "public-key",
    id: base64UrlToBuffer(text(object(item).id)),
    transports: ["internal"],
  }));
}

export function creationOptionsFromJson(json: Json): PublicKeyCredentialCreationOptions {
  const rp = object(json.rp);
  const user = object(json.user);
  return {
    rp: { id: text(rp.id), name: text(rp.name) },
    user: {
      id: base64UrlToBuffer(text(user.id)),
      name: text(user.name),
      displayName: text(user.displayName),
    },
    challenge: base64UrlToBuffer(text(json.challenge)),
    pubKeyCredParams: list(json.pubKeyCredParams).map((item) => {
      const alg = object(item).alg;
      if (typeof alg !== "number") throw malformed();
      return { type: "public-key", alg };
    }),
    timeout: typeof json.timeout === "number" ? json.timeout : undefined,
    excludeCredentials: descriptors(json.excludeCredentials),
    // The same choices the API asks for: this device's own authenticator, which must verify
    // the person, and no attestation.
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "discouraged",
      userVerification: "required",
    },
    attestation: "none",
  };
}

export function requestOptionsFromJson(json: Json): PublicKeyCredentialRequestOptions {
  return {
    challenge: base64UrlToBuffer(text(json.challenge)),
    rpId: typeof json.rpId === "string" ? json.rpId : undefined,
    timeout: typeof json.timeout === "number" ? json.timeout : undefined,
    allowCredentials: descriptors(json.allowCredentials),
    userVerification: "required",
  };
}

function isPublicKeyCredential(credential: Credential | null): credential is PublicKeyCredential {
  return credential !== null && credential.type === "public-key" && "rawId" in credential;
}

function isAttestation(
  response: AuthenticatorResponse,
): response is AuthenticatorAttestationResponse {
  return "attestationObject" in response;
}

function isAssertion(response: AuthenticatorResponse): response is AuthenticatorAssertionResponse {
  return "authenticatorData" in response && "signature" in response;
}

function browserError(error: unknown): DeviceUnlockError {
  if (error instanceof DeviceUnlockError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return new DeviceUnlockError("cancelled", "Cancelled.");
  }
  if (name === "InvalidStateError") {
    return new DeviceUnlockError("already-added", "This device can already unlock Orbit.");
  }
  if (name === "NotSupportedError" || name === "SecurityError") {
    return new DeviceUnlockError(
      "unsupported",
      "This browser can’t use your device’s sign-in here. Open Orbit from its usual address.",
    );
  }
  return new DeviceUnlockError("failed", "Your device couldn’t confirm it’s you. Try again.");
}

/** Ask the device to create a key for Orbit; returns the browser's answer as JSON. */
export async function createDeviceCredential(options: Json): Promise<Json> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: creationOptionsFromJson(options),
    });
  } catch (error) {
    throw browserError(error);
  }
  if (!isPublicKeyCredential(credential) || !isAttestation(credential.response)) {
    throw browserError(null);
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports: response.getTransports(),
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/** Ask the device to confirm the person against Orbit's challenge. */
export async function getDeviceAssertion(options: Json, signal?: AbortSignal): Promise<Json> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: requestOptionsFromJson(options),
      signal,
    });
  } catch (error) {
    throw browserError(error);
  }
  if (!isPublicKeyCredential(credential) || !isAssertion(credential.response)) {
    throw browserError(null);
  }
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/** Whether this device has a built-in authenticator the browser can use here. */
export async function deviceUnlockAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  if (typeof PublicKeyCredential === "undefined") return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** What people call their device's sign-in, for buttons like "Unlock with Touch ID". */
export function deviceUnlockName(userAgent: string): string {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "Face ID or Touch ID";
  if (isMacPlatform(userAgent)) return "Touch ID";
  if (/Windows/.test(userAgent)) return "Windows Hello";
  if (/Android/.test(userAgent)) return "fingerprint";
  return "your device";
}

/** A default name for this device in the list of devices that can unlock Orbit. */
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : isMacPlatform(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows PC"
          : /Android/.test(userAgent)
            ? "Android"
            : "Device";
  return `${browser} on ${device}`;
}

const OWN_DEVICES_KEY = "orbit:app-lock:own-devices";

/** Credential IDs this browser registered; the lock screen offers device unlock only for them. */
export function ownDeviceIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(OWN_DEVICES_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberOwnDevice(credentialId: string): void {
  try {
    const ids = new Set(ownDeviceIds());
    ids.add(credentialId);
    localStorage.setItem(OWN_DEVICES_KEY, JSON.stringify([...ids]));
  } catch {
    // Without storage, this browser can still unlock with the PIN.
  }
}
