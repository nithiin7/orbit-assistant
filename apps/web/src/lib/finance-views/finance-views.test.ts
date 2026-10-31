import { describe, expect, it } from "vitest";

import {
  FINANCE_VIEW_GROUPS,
  FINANCE_VIEWS,
  financeViewHref,
  financeViewLabel,
  groupOf,
  parseFinanceView,
  viewsInGroup,
} from "./finance-views";

describe("parseFinanceView", () => {
  it("reads a known view", () => {
    expect(parseFinanceView("net-worth")).toBe("net-worth");
    expect(parseFinanceView("budgets")).toBe("budgets");
  });

  it("falls back to the overview for a missing or unknown view", () => {
    expect(parseFinanceView(null)).toBe("overview");
    expect(parseFinanceView(undefined)).toBe("overview");
    expect(parseFinanceView("")).toBe("overview");
    expect(parseFinanceView("Budgets")).toBe("overview");
    expect(parseFinanceView("toString")).toBe("overview");
  });
});

describe("financeViewHref", () => {
  it("links to the page itself for the overview", () => {
    expect(financeViewHref("overview")).toBe("/finance");
  });

  it("names any other view in the query string", () => {
    expect(financeViewHref("upcoming")).toBe("/finance?view=upcoming");
  });

  it("round-trips through parseFinanceView", () => {
    for (const { id } of FINANCE_VIEWS) {
      const query = new URL(financeViewHref(id), "http://orbit.test").searchParams;
      expect(parseFinanceView(query.get("view"))).toBe(id);
    }
  });
});

describe("groups", () => {
  it("puts every view but the overview in exactly one group", () => {
    const grouped = FINANCE_VIEW_GROUPS.flatMap((group) => viewsInGroup(group.id));
    expect(grouped).toHaveLength(FINANCE_VIEWS.length - 1);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(viewsInGroup(null)).toEqual(["overview"]);
  });

  it("knows each view's group and label", () => {
    expect(groupOf("bills")).toBe("commitments");
    expect(groupOf("overview")).toBeNull();
    expect(financeViewLabel("net-worth")).toBe("Net worth");
  });
});
