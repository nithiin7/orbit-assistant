import { describe, expect, it } from "vitest";

import {
  assetLook,
  formatPercent,
  formatUnits,
  gainTone,
  holdingSchema,
  parseUnits,
  parseValue,
  rangeStart,
  rateToBps,
  tradeSchema,
} from "./investments";

describe("parseUnits", () => {
  it("normalizes typed units and prices to the API's decimal text", () => {
    expect(parseUnits("218.920")).toBe("218.92");
    expect(parseUnits(" 1,234.5 ")).toBe("1234.5");
    expect(parseUnits("0010")).toBe("10");
    expect(parseUnits("0.000001")).toBe("0.000001");
  });

  it.each(["", "0", "0.000", "-1", "1e3", "1.0000001", "abc", "1.2.3"])("rejects %j", (text) => {
    expect(parseUnits(text)).toBeNull();
  });
});

describe("display helpers", () => {
  it("groups units without losing decimals", () => {
    expect(formatUnits("1234567.891234")).toBe("1,234,567.891234");
    expect(formatUnits("10")).toBe("10");
  });

  it("signs percentages and handles unknown returns", () => {
    expect(formatPercent("12.5")).toBe("+12.5%");
    expect(formatPercent("-3.25")).toBe("-3.25%");
    expect(formatPercent(null)).toBe("—");
  });

  it("colours gains, losses, and nothing", () => {
    expect(gainTone(1)).toBe("text-success");
    expect(gainTone(-1)).toBe("text-destructive");
    expect(gainTone(0)).toBe("text-muted-foreground");
    expect(gainTone(null)).toBe("text-muted-foreground");
  });

  it("finds the start of a date range", () => {
    expect(rangeStart("2025-08-15", "ytd")).toBe("2025-01-01");
    expect(rangeStart("2025-08-15", 12)).toBe("2024-08-15");
    expect(rangeStart("2025-08-15", "all")).toBeUndefined();
  });

  it("converts rates and values with string arithmetic", () => {
    expect(rateToBps("7.1")).toBe(710);
    expect(rateToBps("7.05")).toBe(705);
    expect(rateToBps("12")).toBe(1200);
    expect(parseValue("0", "INR")).toBe(0);
    expect(parseValue("1,250.50", "INR")).toBe(125050);
  });
});

describe("schemas", () => {
  const trade = {
    type: "buy" as const,
    currency: "INR" as const,
    tradeDate: "2025-01-02",
    amount: "15000",
    quantity: "10",
    fees: "",
    plan: "lump_sum" as const,
    settlement: "investment_account" as const,
    cashAccountId: "",
    notes: "",
  };

  it("requires units for trades only", async () => {
    await expect(tradeSchema.validate(trade)).resolves.toBeTruthy();
    await expect(tradeSchema.validate({ ...trade, quantity: "" })).rejects.toThrow(/units/);
    await expect(
      tradeSchema.validate({ ...trade, type: "dividend", quantity: "" }),
    ).resolves.toBeTruthy();
  });

  it("requires an account when money settles through one", async () => {
    await expect(tradeSchema.validate({ ...trade, settlement: "account" })).rejects.toThrow(
      /Choose the account/,
    );
  });

  it("checks ISINs", async () => {
    const holding = {
      accountId: "a",
      kind: "stock" as const,
      name: "Infosys",
      symbol: "",
      exchange: "",
      isin: "INE009A01021",
      issuer: "",
      category: "",
      folio: "",
      notes: "",
    };
    await expect(holdingSchema.validate(holding)).resolves.toBeTruthy();
    await expect(holdingSchema.validate({ ...holding, isin: "123" })).rejects.toThrow(/ISIN/);
  });
});

describe("assetLook", () => {
  it("reads what an asset is from its name", () => {
    expect(assetLook("Flat in Pune", "property")).toBe("apartment");
    expect(assetLook("2BHK Whitefield", "property")).toBe("apartment");
    expect(assetLook("Farm land, Mysuru", "property")).toBe("land");
    expect(assetLook("Honda Activa", "vehicle")).toBe("bike");
    expect(assetLook("Wedding jewellery", "gold")).toBe("jewellery");
    expect(assetLook("MacBook Pro", "other")).toBe("gadget");
    expect(assetLook("Rolex watch", "other")).toBe("watch");
  });

  it("falls back to the category when the name doesn't say", () => {
    expect(assetLook("Honda City", "vehicle")).toBe("car");
    expect(assetLook("Our place", "property")).toBe("house");
    expect(assetLook("SGB 2023", "gold")).toBe("gold");
    expect(assetLook("Emergency stash", "cash")).toBe("cash");
    expect(assetLook("Something", "other")).toBe("other");
  });

  it("only picks looks that fit the category", () => {
    expect(assetLook("Home car", "vehicle")).toBe("car");
    expect(assetLook("Gold coin locker", "gold")).toBe("gold");
    expect(assetLook("Office", "vehicle")).toBe("car");
  });
});
