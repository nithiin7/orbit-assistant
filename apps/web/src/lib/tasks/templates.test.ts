import { describe, expect, it } from "vitest";

import { TASK_TEMPLATES, taskTemplateRequests } from "./templates";

describe("task templates", () => {
  it("adds each task in order, to the given list, with no priority or date", () => {
    const template = TASK_TEMPLATES[0];
    if (!template) throw new Error("expected a template");

    const requests = taskTemplateRequests(template, "list-1");

    expect(requests.map((request) => request.title)).toEqual(template.tasks);
    for (const request of requests) {
      expect(request).toEqual({
        title: request.title,
        description: "",
        priority: "none",
        list_id: "list-1",
      });
    }
  });

  it("has unique ids and no duplicate tasks within a template", () => {
    const ids = TASK_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of TASK_TEMPLATES) {
      expect(new Set(template.tasks).size).toBe(template.tasks.length);
    }
  });
});
