import type { AgentTool } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { agent, tool } from "@/test/agent";

import {
  agentSettingsRequest,
  agentSettingsValues,
  argumentFields,
  argumentValue,
  automationHref,
  describeTrigger,
  hasActive,
  newStep,
  parseAgentTab,
  WORKFLOW_TEMPLATES,
  workflowFormValues,
  workflowRequest,
} from "./agent";

describe("where things live", () => {
  it("reads and builds tab locations", () => {
    expect(parseAgentTab("approvals")).toBe("approvals");
    expect(parseAgentTab("nonsense")).toBe("overview");
    expect(parseAgentTab(null)).toBe("overview");
    expect(automationHref()).toBe("/automation");
    expect(automationHref("activity", { run: "r1" })).toBe("/automation?tab=activity&run=r1");
  });
});

describe("describing triggers", () => {
  it("says when a workflow starts", () => {
    expect(describeTrigger({ kind: "manual" })).toBe("When you run it");
    expect(
      describeTrigger({
        kind: "schedule",
        schedule: {
          frequency: "weekly",
          time: "08:00",
          timezone: "UTC",
          weekdays: [0, 4],
          day_of_month: null,
          on_date: null,
        },
      }),
    ).toBe("Every Mon, Fri at 08:00");
    expect(
      describeTrigger({
        kind: "event",
        event: { event: "document_expiring", lead_minutes: 60, days_ahead: 30 },
      }),
    ).toBe("When a document is about to expire");
    expect(
      describeTrigger({
        kind: "condition",
        condition: {
          metric: "overdue_tasks",
          op: "gte",
          value: 3,
          check_minutes: 60,
          days_ahead: 7,
        },
      }),
    ).toBe("When overdue tasks is at least 3");
  });

  it("knows when runs are still in progress", () => {
    const run = (status: "queued" | "succeeded") =>
      ({ status }) as Parameters<typeof hasActive>[0][number];
    expect(hasActive([run("succeeded"), run("queued")])).toBe(true);
    expect(hasActive([run("succeeded")])).toBe(false);
  });
});

describe("tool arguments", () => {
  const search: AgentTool = tool("search_tasks", {
    type: "object",
    properties: {
      query: {
        anyOf: [{ type: "string" }, { type: "null" }],
        title: "Query",
        description: "Words.",
      },
      status: { enum: ["open", "completed", "any"], type: "string", title: "Status" },
      overdue_only: { type: "boolean", title: "Overdue Only" },
      limit: { type: "integer", title: "Limit" },
    },
    required: ["query"],
  });

  it("derives fields from the tool's schema", () => {
    const fields = argumentFields(search);
    expect(fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ["query", "text", true],
      ["status", "choice", false],
      ["overdue_only", "boolean", false],
      ["limit", "number", false],
    ]);
    expect(fields[1]?.options).toEqual(["open", "completed", "any"]);
  });

  it("types values by their field, keeping placeholders as text", () => {
    const [query, , overdue, limit] = argumentFields(search);
    expect(argumentValue(limit, "5")).toBe(5);
    expect(argumentValue(limit, "{{steps.find.count}}")).toBe("{{steps.find.count}}");
    expect(argumentValue(overdue, "true")).toBe(true);
    expect(argumentValue(query, "  ")).toBeUndefined();
  });
});

describe("the workflow form", () => {
  it("round-trips every template through the form unchanged", () => {
    const tools = [
      tool("search_tasks", {
        type: "object",
        properties: { due_within_days: { type: "integer" }, overdue_only: { type: "boolean" } },
      }),
      tool("search_calendar", { type: "object", properties: { days_ahead: { type: "integer" } } }),
      tool("send_notification", {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
      }),
      tool("create_task", {
        type: "object",
        properties: {
          title: { type: "string" },
          due_date: { type: "string" },
          priority: { enum: ["none", "high"] },
        },
      }),
    ];
    for (const template of WORKFLOW_TEMPLATES) {
      const original = template.workflow("Europe/Paris");
      const again = workflowRequest(workflowFormValues(original, "UTC"), tools);
      expect(again).toEqual(original);
    }
  });

  it("gives new steps unique ids", () => {
    expect(newStep("tool", ["tool_1", "tool_2"]).id).toBe("tool_3");
    expect(newStep("ai", []).id).toBe("ai_1");
  });
});

describe("the settings form", () => {
  it("always keeps reading allowed and drops tools left at the default", () => {
    const values = agentSettingsValues(agent({ tool_modes: { create_task: "auto" } }));
    const request = agentSettingsRequest({
      ...values,
      canCreate: false,
      canUpdate: true,
      chatModel: "  ",
      toolModes: { create_task: "", complete_task: "off" },
    });
    expect(request.action_types).toEqual(["read", "update"]);
    expect(request.tool_modes).toEqual({ complete_task: "off" });
    expect(request.chat_model).toBeNull();
  });
});
