import type { AiPortfolioReview, AiSettings } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useReviewPortfolio } from "@/hooks/use-ai";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { PortfolioReview } from "./portfolio-review";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/finance",
  useSearchParams: () => new URLSearchParams(),
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const REVIEW = `POST /api/v1/workspaces/${personal.id}/ai/finance/portfolio-review`;

function aiSettings(modules: AiSettings["modules"]): AiSettings {
  return {
    server_enabled: true,
    enabled: true,
    chat_provider_id: "p1",
    chat_model: "llama3",
    embedding_provider_id: null,
    embedding_model: null,
    fallback_provider_id: null,
    fallback_model: null,
    allow_cloud: false,
    modules,
    response_style: "balanced",
    monthly_token_limit: null,
    indexing_enabled: true,
  };
}

const review: AiPortfolioReview = {
  currency: "INR",
  score: 68,
  headline: "Solid core, a little crowded in flexi caps",
  summary: "Mostly equity funds with one large stock position.",
  strengths: [{ title: "Low-cost index core", detail: "Two index funds anchor it." }],
  improvements: [
    {
      title: "Infosys is a large single bet",
      detail: "One stock is 64% of the portfolio.",
      action: "Direct new money to your funds until it is under 20%.",
      priority: "high",
    },
  ],
  holdings: [
    {
      holding_id: "h1",
      name: "Infosys",
      kind: "stock",
      verdict: "review",
      note: "Largest single position.",
    },
  ],
  facts: {
    holdings: 3,
    deposits: 0,
    allocation: [
      { key: "stock", label: "Stocks", value: 72_000_00 },
      { key: "mutual_fund", label: "Mutual funds", value: 40_000_00 },
    ],
    return_percent: "12.5",
    largest_holding: "Infosys",
    largest_share: "64.29",
    top_five_share: "100",
    cash_share: null,
    fund_houses: 2,
    overlaps: [{ category: "Flexi cap", funds: 2 }],
    active_sips: 1,
    unpriced: 2,
  },
  provider_name: "Local",
  model: "llama3",
  processing: "local",
};

function Harness() {
  const mutation = useReviewPortfolio(personal.id);
  return (
    <div className="@container/list">
      <PortfolioReview currency="INR" review={mutation} />
    </div>
  );
}

describe("PortfolioReview", () => {
  it("asks for Finance access before it can review", async () => {
    mockApi({ ...session, "GET /api/v1/me/ai/settings": json(aiSettings(["notes"])) });

    await renderSignedIn(<Harness />);

    expect(await screen.findByText("Let AI review your portfolio")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open AI settings" })).toHaveAttribute(
      "href",
      expect.stringContaining("ai"),
    );
    expect(screen.queryByRole("button", { name: "Review my portfolio" })).not.toBeInTheDocument();
  });

  it("sends the currency and context, then shows the review", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(aiSettings(["finance"])),
      [REVIEW]: (request: MockRequest) => {
        sent.push(request.body);
        return Response.json(review);
      },
    });

    await renderSignedIn(<Harness />);
    await user.type(
      await screen.findByRole("textbox", { name: "Anything to keep in mind" }),
      "  Retiring in 20 years  ",
    );
    await user.click(screen.getByRole("button", { name: "Review my portfolio" }));

    expect(await screen.findByRole("img", { name: "Score 68 out of 100" })).toBeInTheDocument();
    expect(sent).toEqual([{ currency: "INR", focus: "Retiring in 20 years" }]);
    expect(screen.getByText("Room to improve")).toBeInTheDocument();
    expect(screen.getByText(review.headline)).toBeInTheDocument();

    const good = screen.getByRole("region", { name: "What looks good" });
    expect(within(good).getByText("Low-cost index core")).toBeInTheDocument();
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText("High priority")).toBeInTheDocument();
    expect(within(attention).getByText(/Direct new money/)).toBeInTheDocument();
    const notes = screen.getByRole("region", { name: "Holding by holding" });
    expect(within(notes).getByText("Review")).toBeInTheDocument();

    const glance = screen.getByRole("region", { name: "At a glance" });
    expect(within(glance).getByText("64.3%")).toBeInTheDocument();
    expect(within(glance).getByText("Flexi cap (2)")).toBeInTheDocument();
    expect(within(glance).getByText(/2 holdings have no current price/)).toBeInTheDocument();
    expect(screen.getByText(/isn’t financial advice/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review again" })).toBeInTheDocument();
  });

  it("shows the server's reason when a review fails", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      "GET /api/v1/me/ai/settings": json(aiSettings(["finance"])),
      [REVIEW]: status(422, "Add a holding or a deposit in this currency first."),
    });

    await renderSignedIn(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Review my portfolio" }));

    expect(
      await screen.findByText("Add a holding or a deposit in this currency first."),
    ).toBeInTheDocument();
  });
});
