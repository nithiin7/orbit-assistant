import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findTemplate } from "@/lib/agent";
import { agent, approval, execution, overview, tool } from "@/test/agent";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AutomationView } from "./automation-view";

const search = { params: new URLSearchParams() };
const router = { replace: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/automation",
  useSearchParams: () => search.params,
}));

const AGENT = `/api/v1/workspaces/${personal.id}/agent`;

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

const TOOLS = [
  tool("search_tasks", {
    type: "object",
    properties: { due_within_days: { type: "integer", title: "Due Within Days" } },
  }),
  tool("search_calendar", { type: "object", properties: { days_ahead: { type: "integer" } } }),
  tool("send_notification", {
    type: "object",
    properties: { title: { type: "string", title: "Title" }, body: { type: "string" } },
    required: ["title"],
  }),
  tool("create_task", { type: "object", properties: { title: { type: "string" } } }),
  tool(
    "run_workflow",
    { type: "object", properties: {} },
    { in_workflows: false, approval: "always" },
  ),
];

function at(tab: string, extra: Record<string, string> = {}) {
  search.params = new URLSearchParams({ tab, ...extra });
}

beforeEach(() => {
  search.params = new URLSearchParams();
  router.replace.mockReset();
  router.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Automation overview", () => {
  it("shows the agent's state and turns it on", async () => {
    const user = userEvent.setup();
    const patched: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview({ agent: agent({ enabled: false }) })),
      [`PATCH ${AGENT}`]: (request: MockRequest) => {
        patched.push(request.body);
        return Response.json(agent({ enabled: true }));
      },
    });
    await renderSignedIn(<AutomationView />);
    expect(await screen.findByText(/Off · Ask first/)).toBeInTheDocument();
    // There's nothing to ask while it is off.
    expect(screen.queryByRole("heading", { name: "Ask the agent" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Agent on" }));
    await waitFor(() => expect(patched).toEqual([{ enabled: true }]));
  });

  it("marks the current section and suggests templates before any workflow exists", async () => {
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview({ pending_approvals: 2 })),
    });
    await renderSignedIn(<AutomationView />);
    expect(await screen.findByRole("heading", { name: "Try a template" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Automation sections" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Workflows", "Approvals2 waiting", "History", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    const approvals = within(nav).getByRole("link", { name: /^Approvals/ });
    expect(approvals).toHaveAttribute("href", "/automation?tab=approvals");
    expect(approvals).toHaveTextContent("2 waiting");
    expect(screen.getByRole("link", { name: /Plan the week/ })).toHaveAttribute(
      "href",
      "/automation?tab=workflows&template=week",
    );
  });

  it("starts a run for the person's request", async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview({ recent: [execution()] })),
      [`POST ${AGENT}/runs`]: (request: MockRequest) => {
        posted.push(request.body);
        return Response.json(execution({ id: "e2", status: "queued" }), { status: 202 });
      },
    });
    await renderSignedIn(<AutomationView />);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText(/Say what you’d like the agent to do/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("What should the agent do?"), "Plan my week");
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("link", { name: "Follow it" })).toHaveAttribute(
      "href",
      "/automation?tab=activity&run=e2",
    );
    expect(posted).toEqual([{ goal: "Plan my week", idempotency_key: expect.any(String) }]);
    expect(screen.getByRole("link", { name: /Plan my week/ })).toBeInTheDocument();
  });
});

describe("Approval center", () => {
  it("shows exactly what will run and approves that action", async () => {
    at("approvals");
    const user = userEvent.setup();
    const decided: unknown[] = [];
    const waiting = approval({ from_untrusted_context: true });
    const done = approval({
      status: "executed",
      result: { kind: "task", id: "t1", title: "Call the bank", day: null, detail: "" },
    });
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview({ pending_approvals: 1 })),
      // Both lists are served by one route here; each view keeps only its own statuses.
      [`GET ${AGENT}/approvals`]: () =>
        Response.json({ approvals: [decided.length ? done : waiting] }),
      [`POST ${AGENT}/approvals/ap1/approve`]: (request: MockRequest) => {
        decided.push(request.body);
        return Response.json(done);
      },
    });
    await renderSignedIn(<AutomationView />);
    const card = await screen.findByRole("region", { name: /Approval: Create task/ });
    expect(within(card).getByText("A new task is added.")).toBeInTheDocument();
    expect(within(card).getByText("Call the bank")).toBeInTheDocument();
    expect(within(card).getByText(/can contain misleading instructions/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Approvals/ })).toHaveTextContent("1");
    await user.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("link", { name: "Open Call the bank" })).toBeInTheDocument();
    expect(await screen.findByText("No approvals waiting")).toBeInTheDocument();
    expect(decided).toEqual([{ arguments_hash: "a".repeat(64) }]);
  });

  it("says when nothing is waiting", async () => {
    at("approvals");
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/approvals`]: json({ approvals: [] }),
    });
    await renderSignedIn(<AutomationView />);
    expect(await screen.findByText("No approvals waiting")).toBeInTheDocument();
  });
});

describe("Workflows", () => {
  it("refuses a workflow without steps before saving", async () => {
    at("workflows");
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/workflows`]: json({ workflows: [] }),
    });
    await renderSignedIn(<AutomationView />);
    await user.click(await screen.findByRole("button", { name: "New workflow" }));
    const dialog = await screen.findByRole("dialog", { name: "New workflow" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Empty");
    await user.click(within(dialog).getByRole("button", { name: "Save workflow" }));
    expect(await within(dialog).findByText("Add at least one step.")).toBeInTheDocument();
  });
});

describe("Workflows", () => {
  it("shows when a workflow runs and starts it from its menu", async () => {
    at("workflows");
    const user = userEvent.setup();
    const briefing = findTemplate("briefing")?.workflow("UTC");
    if (!briefing) throw new Error("No briefing template");
    const ran: string[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview({ workflows: 1 })),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/workflows`]: json({
        workflows: [
          {
            ...briefing,
            id: "w1",
            next_run_at: null,
            last_run_at: null,
            created_at: "2026-11-01T09:00:00Z",
            updated_at: "2026-11-01T09:00:00Z",
          },
        ],
      }),
      [`POST ${AGENT}/workflows/w1/run`]: (request: MockRequest) => {
        ran.push(request.path);
        return Response.json(execution({ id: "e9", status: "queued" }), { status: 202 });
      },
    });
    await renderSignedIn(<AutomationView />);
    expect(
      await screen.findByRole("button", { name: /^Morning briefingEvery day at 08:00$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Morning briefing on" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Actions for Morning briefing" }));
    await user.click(await screen.findByRole("menuitem", { name: "Run now" }));
    expect(await screen.findByRole("link", { name: "Follow it" })).toHaveAttribute(
      "href",
      "/automation?tab=activity&run=e9",
    );
    expect(ran).toHaveLength(1);
  });
});

describe("Templates", () => {
  it("lists templates under the workflows and creates one from a template", async () => {
    at("workflows");
    const user = userEvent.setup();
    const created: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/workflows`]: json({ workflows: [] }),
      [`POST ${AGENT}/workflows`]: (request: MockRequest) => {
        created.push(request.body);
        return Response.json({}, { status: 201 });
      },
    });
    await renderSignedIn(<AutomationView />);
    expect(await screen.findByText(/No workflows yet/)).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /^Morning briefing/ });
    expect(card).toHaveTextContent("Every day at 08:00");
    await user.click(card);
    const dialog = await screen.findByRole("dialog", { name: "Morning briefing" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Morning briefing");
    expect(within(dialog).getByText("steps.brief")).toBeInTheDocument();
    // Tools that only agent runs can use aren't offered to workflows.
    expect(within(dialog).queryByText("run workflow")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save workflow" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Morning briefing",
      trigger: {
        kind: "schedule",
        schedule: { frequency: "daily", time: "08:00", timezone: "UTC" },
      },
      steps: [
        { id: "tasks", kind: "tool", tool: "search_tasks", arguments: { due_within_days: 0 } },
        { id: "calendar", kind: "tool", tool: "search_calendar" },
        { id: "brief", kind: "ai" },
        { id: "tell", kind: "tool", tool: "send_notification", arguments: { title: "Your day" } },
      ],
    });
  });

  it("filters by category and says which modules a template still needs", async () => {
    at("workflows");
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/workflows`]: json({ workflows: [] }),
    });
    await renderSignedIn(<AutomationView />);
    await user.click(await screen.findByRole("button", { name: "Money" }));
    expect(screen.getByRole("button", { name: "Money" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /^Morning briefing/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Budget watch/ })).toHaveTextContent(
      "Needs Finance (read only)",
    );
  });

  it("opens a template from a link, and forgets it when closed", async () => {
    at("templates", { template: "week" });
    const user = userEvent.setup();
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/workflows`]: json({ workflows: [] }),
    });
    await renderSignedIn(<AutomationView />);
    const dialog = await screen.findByRole("dialog", { name: "Plan the week" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Plan the week");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/automation?tab=workflows"));
  });
});

describe("Activity", () => {
  it("shows a run's steps, reasons, and failures, and retries it", async () => {
    at("activity", { run: "e1" });
    const user = userEvent.setup();
    const retried: string[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/executions/e1`]: json({
        execution: execution({
          status: "failed",
          summary: null,
          error: "Stopped after 8 steps without finishing.",
        }),
        steps: [
          {
            id: "s1",
            position: 0,
            kind: "tool",
            title: "search_tasks",
            tool: "search_tasks",
            reason: "Find what's overdue",
            arguments: { overdue_only: true },
            status: "succeeded",
            output: "## Tasks (1 matching)",
            records: [{ kind: "task", id: "t1", title: "Taxes", day: null, detail: "" }],
            error: null,
            approval_id: null,
            autonomous: false,
            started_at: "2026-11-02T09:00:02Z",
            finished_at: "2026-11-02T09:00:03Z",
          },
          {
            id: "s2",
            position: 1,
            kind: "tool",
            title: "get_accounts",
            tool: "get_accounts",
            reason: "",
            arguments: {},
            status: "denied",
            output: "",
            records: [],
            error: "The agent isn't allowed to use finance.",
            approval_id: null,
            autonomous: false,
            started_at: "2026-11-02T09:00:04Z",
            finished_at: "2026-11-02T09:00:04Z",
          },
        ],
        approvals: [],
      }),
      [`POST ${AGENT}/executions/e1/retry`]: (request: MockRequest) => {
        retried.push(request.path);
        return Response.json(execution({ status: "queued" }));
      },
    });
    await renderSignedIn(<AutomationView />);
    expect(await screen.findByRole("heading", { name: "Plan my week" })).toBeInTheDocument();
    expect(screen.getByText("Why: Find what's overdue")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Taxes" })).toHaveAttribute("href", "/tasks?task=t1");
    expect(screen.getByText("Not allowed")).toBeInTheDocument();
    expect(screen.getByText("The agent isn't allowed to use finance.")).toBeInTheDocument();
    expect(screen.getByText("Stopped after 8 steps without finishing.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retried).toHaveLength(1));
  });
});

describe("Settings", () => {
  it("saves the autonomy level and permissions, keeping reads allowed", async () => {
    at("settings");
    const user = userEvent.setup();
    const saved: unknown[] = [];
    mockApi({
      ...session,
      [`GET ${AGENT}`]: json(overview()),
      [`GET ${AGENT}/tools`]: json({ tools: TOOLS }),
      [`GET ${AGENT}/memories`]: json({ memories: [] }),
      [`PATCH ${AGENT}`]: (request: MockRequest) => {
        saved.push(request.body);
        return Response.json(agent({ autonomy: "read_only" }));
      },
    });
    await renderSignedIn(<AutomationView />);
    await user.click(await screen.findByRole("radio", { name: /Read only/ }));
    expect(screen.getByText(/run while Orbit is running on this device/)).toBeInTheDocument();
    const modules = screen.getByRole("group", { name: "Modules" });
    await user.click(within(modules).getByRole("checkbox", { name: /Finance/ }));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      autonomy: "read_only",
      action_types: ["read", "create", "update"],
      modules: expect.arrayContaining(["finance", "tasks"]),
    });
  });
});
