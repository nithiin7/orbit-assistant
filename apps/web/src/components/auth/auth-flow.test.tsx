import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOCAL_SESSION_KEY, readLocalSession } from "@/lib/auth/local-session";
import { AuthProvider } from "@/providers/auth-provider";
import { ada, json, mockApi, status } from "@/test/api-mock";
import { SESSION_TOKEN, storeSession } from "@/test/session";

import { RequireAuth } from "./require-auth";
import { SignInForm } from "./sign-in-form";
import { SignUpForm } from "./sign-up-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const pathname = vi.hoisted(() => ({ current: "/settings" }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname.current,
}));

const localConfig = json({ provider: "local", registration_open: true });
const session = {
  access_token: "new-token",
  token_type: "bearer",
  expires_at: "2999-01-01T00:00:00Z",
  user: ada,
};

beforeEach(() => {
  pathname.current = "/settings";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderProtected() {
  render(
    <AuthProvider>
      <RequireAuth>
        <p>Private page</p>
      </RequireAuth>
    </AuthProvider>,
  );
}

describe("protected routes", () => {
  it("restore a stored session after the API confirms it", async () => {
    storeSession();
    const api = mockApi({ "GET /api/v1/auth/config": localConfig, "GET /api/v1/me": json(ada) });

    renderProtected();

    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");
    expect(await screen.findByText("Private page")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/me",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${SESSION_TOKEN}` }) as unknown,
      }),
    );
  });

  it("send visitors without a session to sign in, remembering the page", async () => {
    const api = mockApi({ "GET /api/v1/auth/config": localConfig });

    renderProtected();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sign-in?next=%2Fsettings"));
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("discard a session the API rejects", async () => {
    storeSession();
    mockApi({ "GET /api/v1/auth/config": localConfig, "GET /api/v1/me": status(401) });

    renderProtected();

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(localStorage.getItem(LOCAL_SESSION_KEY)).toBeNull();
    expect(screen.queryByText("Private page")).not.toBeInTheDocument();
  });

  it("keep the session and offer a retry when the API is unavailable", async () => {
    const user = userEvent.setup();
    storeSession();
    let available = false;
    mockApi({
      "GET /api/v1/auth/config": localConfig,
      "GET /api/v1/me": () =>
        available ? Response.json(ada) : new Response(null, { status: 503 }),
    });

    renderProtected();

    expect(await screen.findByRole("alert")).toHaveTextContent(/database is unavailable/);
    expect(readLocalSession()?.token).toBe(SESSION_TOKEN);
    expect(router.replace).not.toHaveBeenCalled();

    available = true;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Private page")).toBeInTheDocument();
  });

  it("explain when the API can't be reached at all", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    renderProtected();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Can’t reach the Orbit API/);
  });
});

describe("SignInForm", () => {
  function renderSignIn(next = "/") {
    render(
      <AuthProvider>
        <SignInForm next={next} />
      </AuthProvider>,
    );
  }

  it("validates fields before contacting the API", async () => {
    const user = userEvent.setup();
    const api = mockApi({ "GET /api/v1/auth/config": localConfig });
    renderSignIn();

    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription("Enter your email address.");
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("signs in and returns to the requested page", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/v1/auth/config": localConfig,
      "POST /api/v1/auth/local/sign-in": json(session),
      "GET /api/v1/me": json(ada),
    });
    renderSignIn("/settings");

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/settings"));
    expect(readLocalSession()?.token).toBe("new-token");
  });

  it("shows the API's error and lets the user try again", async () => {
    const user = userEvent.setup();
    mockApi({
      "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
      "POST /api/v1/auth/local/sign-in": status(401, "The email or password is incorrect."),
    });
    renderSignIn();

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The email or password is incorrect.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Create an account" })).not.toBeInTheDocument();
  });
});

describe("SignUpForm", () => {
  function renderSignUp() {
    render(
      <AuthProvider>
        <SignUpForm />
      </AuthProvider>,
    );
  }

  it("creates the first local account and opens Orbit", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      "GET /api/v1/auth/config": localConfig,
      "POST /api/v1/auth/local/sign-up": json(session, 201),
      "GET /api/v1/me": json(ada),
    });
    renderSignUp();

    expect(await screen.findByText(/stored on this computer/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const signUpCall = api.mock.calls.find(([url]) => String(url).endsWith("/sign-up"));
    expect(JSON.parse(String(signUpCall?.[1]?.body))).toMatchObject({ display_name: "Ada" });
  });

  it("explains the password requirement", async () => {
    const user = userEvent.setup();
    mockApi({ "GET /api/v1/auth/config": localConfig });
    renderSignUp();

    await user.type(await screen.findByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(
      "At least 8 characters. Use at least 8 characters.",
    );
  });

  it("explains that sign-up is closed once the installation has an account", async () => {
    mockApi({
      "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    });
    renderSignUp();

    expect(await screen.findByRole("heading", { name: "Sign-up is closed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
