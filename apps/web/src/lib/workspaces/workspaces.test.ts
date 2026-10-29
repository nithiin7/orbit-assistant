import { describe, expect, it } from "vitest";

import { lab, personal } from "@/test/api-mock";

import { pickActiveWorkspace, workspaceInitial } from "./workspaces";

describe("pickActiveWorkspace", () => {
  it("prefers the remembered workspace while the user still has it", () => {
    expect(pickActiveWorkspace([personal, lab], lab.id)).toBe(lab);
  });

  it("falls back to the personal workspace for unknown or missing preferences", () => {
    expect(pickActiveWorkspace([lab, personal], "someone-elses-workspace")).toBe(personal);
    expect(pickActiveWorkspace([lab, personal], null)).toBe(personal);
  });

  it("handles lists without a personal workspace, or no workspaces at all", () => {
    expect(pickActiveWorkspace([lab], null)).toBe(lab);
    expect(pickActiveWorkspace([], null)).toBeNull();
  });
});

describe("workspaceInitial", () => {
  it("uses the first character, uppercased", () => {
    expect(workspaceInitial(" lab")).toBe("L");
    expect(workspaceInitial("Ölfabrik")).toBe("Ö");
    expect(workspaceInitial("")).toBe("?");
  });
});
