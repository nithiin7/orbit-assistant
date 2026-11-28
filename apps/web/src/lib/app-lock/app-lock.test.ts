import { describe, expect, it } from "vitest";

import {
  base64UrlToBuffer,
  bufferToBase64Url,
  creationOptionsFromJson,
  deviceLabel,
  deviceUnlockName,
  digitFromKey,
  durationLabel,
  isIdle,
  isPin,
  lockAfterOptions,
  parseLockEvent,
  requestOptionsFromJson,
  signOutAfterFor,
  signOutAfterOptions,
} from ".";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0";

describe("timing", () => {
  it("names durations in the largest whole unit", () => {
    expect(durationLabel(1)).toBe("1 minute");
    expect(durationLabel(90)).toBe("90 minutes");
    expect(durationLabel(120)).toBe("2 hours");
    expect(durationLabel(1440)).toBe("1 day");
    expect(durationLabel(10080)).toBe("7 days");
  });

  it("keeps a custom lock delay among the choices", () => {
    const values = lockAfterOptions(7).map((option) => option.value);

    expect(values).toContain("7");
    expect(values.indexOf("7")).toBe(values.indexOf("5") + 1);
  });

  it("offers only sign-out delays longer than the lock delay", () => {
    const options = signOutAfterOptions(60, null);

    expect(options[0]).toEqual({ value: "never", label: "Never" });
    expect(options.map((option) => Number(option.value)).slice(1)).toSatisfy((values: number[]) =>
      values.every((minutes) => minutes > 60),
    );
  });

  it("moves the sign-out delay past a longer lock delay", () => {
    expect(signOutAfterFor(5, null)).toBeNull();
    expect(signOutAfterFor(5, 60)).toBe(60);
    expect(signOutAfterFor(60, 60)).toBe(240);
    expect(signOutAfterFor(1440, 240)).toBe(4320);
  });
});

describe("activity", () => {
  it("is idle once the lock delay has passed", () => {
    expect(isIdle(0, 59_999, 1)).toBe(false);
    expect(isIdle(0, 60_000, 1)).toBe(true);
  });

  it("reads lock events from other tabs", () => {
    expect(parseLockEvent("locked:1700000000000")).toBe("locked");
    expect(parseLockEvent("unlocked:1")).toBe("unlocked");
    expect(parseLockEvent("opened:1")).toBeNull();
    expect(parseLockEvent(null)).toBeNull();
  });
});

describe("pin", () => {
  it("accepts only digits of the right length", () => {
    expect(isPin("2468", 4)).toBe(true);
    expect(isPin("246", 4)).toBe(false);
    expect(isPin("24a8", 4)).toBe(false);
    expect(digitFromKey("7")).toBe("7");
    expect(digitFromKey("Enter")).toBeNull();
  });
});

describe("webauthn", () => {
  it("round-trips base64url", () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);

    const encoded = bufferToBase64Url(bytes.buffer);

    expect(encoded).toBe("APv_Pj8B");
    expect(new Uint8Array(base64UrlToBuffer(encoded))).toEqual(bytes);
  });

  it("turns the API's registration options into browser options", () => {
    const options = creationOptionsFromJson({
      rp: { id: "localhost", name: "Orbit" },
      user: { id: "AQID", name: "ada@example.com", displayName: "Ada" },
      challenge: "BAUG",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60000,
      excludeCredentials: [{ id: "BwgJ", type: "public-key" }],
    });

    expect(new Uint8Array(options.challenge as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
    expect(options.rp).toEqual({ id: "localhost", name: "Orbit" });
    expect(options.pubKeyCredParams).toEqual([{ type: "public-key", alg: -7 }]);
    expect(options.excludeCredentials?.[0]?.transports).toEqual(["internal"]);
    expect(options.authenticatorSelection).toEqual({
      authenticatorAttachment: "platform",
      residentKey: "discouraged",
      userVerification: "required",
    });
  });

  it("asks only for this device's own credentials when unlocking", () => {
    const options = requestOptionsFromJson({
      challenge: "BAUG",
      rpId: "localhost",
      allowCredentials: [{ id: "BwgJ", type: "public-key" }],
    });

    expect(options.rpId).toBe("localhost");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials?.map((item) => item.transports)).toEqual([["internal"]]);
  });

  it("refuses malformed options", () => {
    expect(() => creationOptionsFromJson({ rp: "nope" })).toThrow("can’t use");
  });

  it("names the device's sign-in the way people know it", () => {
    expect(deviceUnlockName(MAC_CHROME)).toBe("Touch ID");
    expect(deviceUnlockName(WINDOWS_EDGE)).toBe("Windows Hello");
    expect(deviceLabel(MAC_CHROME)).toBe("Chrome on Mac");
    expect(deviceLabel(WINDOWS_EDGE)).toBe("Edge on Windows PC");
  });
});
