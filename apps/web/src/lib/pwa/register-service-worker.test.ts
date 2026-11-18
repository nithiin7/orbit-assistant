import { registerServiceWorker } from "./register-service-worker";

function stubServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
}

describe("registerServiceWorker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
  });

  it("registers the worker for the whole app in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker(register);

    await registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it("does nothing outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = vi.fn().mockResolvedValue({});
    stubServiceWorker(register);

    await registerServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing when the browser has no service workers", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(registerServiceWorker()).resolves.toBeUndefined();
  });

  it("keeps the app working when registration fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubServiceWorker(vi.fn().mockRejectedValue(new Error("blocked")));

    await expect(registerServiceWorker()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
