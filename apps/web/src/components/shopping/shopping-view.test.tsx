import type { ShoppingItem, ShoppingListOverview } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ShoppingPanel } from "./shopping-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/shopping",
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const SHOP = `/api/v1/workspaces/${personal.id}/shopping`;

function list(
  overrides: Partial<ShoppingListOverview> & Pick<ShoppingListOverview, "id" | "name">,
) {
  return {
    workspace_id: personal.id,
    is_default: false,
    needed_count: 0,
    purchased_count: 0,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  } satisfies ShoppingListOverview;
}

function item(overrides: Partial<ShoppingItem> & Pick<ShoppingItem, "id" | "name">) {
  return {
    workspace_id: personal.id,
    list_id: groceries.id,
    quantity: null,
    url: null,
    notes: "",
    status: "needed",
    purchased_at: null,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    ...overrides,
  } satisfies ShoppingItem;
}

const groceries = list({ id: "l-groceries", name: "Groceries", is_default: true, needed_count: 2 });
const electronics = list({ id: "l-electronics", name: "Electronics", needed_count: 1 });
const milk = item({ id: "i-milk", name: "Milk", quantity: "2 L", created_at: "2026-10-01T08:00Z" });
const eggs = item({ id: "i-eggs", name: "Eggs", url: "https://www.example.com/eggs?id=1" });
const cable = item({ id: "i-cable", name: "USB-C cable", list_id: electronics.id });

const listsRoute = { [`GET ${SHOP}/lists`]: json({ lists: [groceries, electronics] }) };
const itemsRoutes = {
  [`GET ${SHOP}/lists/${groceries.id}/items`]: json({ items: [milk, eggs] }),
  [`GET ${SHOP}/lists/${electronics.id}/items`]: json({ items: [cable] }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ShoppingPanel", () => {
  it("opens the default list with its items, quantities, and links", async () => {
    mockApi({ ...session, ...listsRoute, ...itemsRoutes });

    await renderSignedIn(<ShoppingPanel />);

    const toBuy = await screen.findByRole("list", { name: "2 items to buy" });
    const rows = within(toBuy).getAllByRole("listitem");
    expect(within(rows[0]!).getByRole("checkbox", { name: "Milk" })).not.toBeChecked();
    expect(rows[0]).toHaveTextContent("2 L");
    const link = within(rows[1]!).getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("href", "https://www.example.com/eggs?id=1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByRole("button", { name: "Groceries, 2 to buy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The default list can be renamed but not deleted.
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("switches between lists", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, ...listsRoute, ...itemsRoutes });
    await renderSignedIn(<ShoppingPanel />);
    await screen.findByRole("checkbox", { name: "Milk" });

    await user.click(screen.getByRole("button", { name: "Electronics, 1 to buy" }));

    expect(await screen.findByRole("checkbox", { name: "USB-C cable" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Milk" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Electronics" })).toBeInTheDocument();
  });

  it("explains an empty list", async () => {
    mockApi({
      ...session,
      [`GET ${SHOP}/lists`]: json({ lists: [{ ...groceries, needed_count: 0 }] }),
      [`GET ${SHOP}/lists/${groceries.id}/items`]: json({ items: [] }),
    });

    await renderSignedIn(<ShoppingPanel />);

    expect(
      await screen.findByRole("heading", { name: "Nothing on this list yet" }),
    ).toBeInTheDocument();
  });

  it("adds an item with a quantity and link from the keyboard", async () => {
    const user = userEvent.setup();
    const bread = item({
      id: "i-bread",
      name: "Bread",
      quantity: "1",
      url: "https://bakery.example",
    });
    const posted: unknown[] = [];
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`POST ${SHOP}/lists/${groceries.id}/items`]: ({ body }: MockRequest) => {
        posted.push(body);
        return Response.json(bread, { status: 201 });
      },
    });
    await renderSignedIn(<ShoppingPanel />);
    await screen.findByRole("checkbox", { name: "Milk" });

    await user.keyboard("n");
    const name = screen.getByRole("textbox", { name: "Item" });
    expect(name).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: "Quantity (optional)" }), "1");
    await user.type(
      screen.getByRole("textbox", { name: "Link (optional)" }),
      "https://bakery.example",
    );
    await user.type(name, " Bread {Enter}");

    expect(await screen.findByRole("list", { name: "3 items to buy" })).toBeInTheDocument();
    expect(posted).toEqual([
      { name: "Bread", quantity: "1", url: "https://bakery.example", notes: "" },
    ]);
    expect(name).toHaveValue("");
    expect(screen.getByRole("button", { name: "Groceries, 3 to buy" })).toBeInTheDocument();
  });

  it("rejects links that aren't web addresses before sending them", async () => {
    const user = userEvent.setup();
    const api = mockApi({ ...session, ...listsRoute, ...itemsRoutes });
    await renderSignedIn(<ShoppingPanel />);
    await screen.findByRole("checkbox", { name: "Milk" });

    await user.type(
      screen.getByRole("textbox", { name: "Link (optional)" }),
      "javascript:alert(1)",
    );
    await user.type(screen.getByRole("textbox", { name: "Item" }), "Bread{Enter}");

    expect(
      await screen.findByText("Enter a full web address, starting with https://"),
    ).toBeInTheDocument();
    expect(api.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("checks an item off into the bought section and restocks it", async () => {
    const user = userEvent.setup();
    let restocked = false;
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`POST ${SHOP}/items/${milk.id}/purchase`]: json({
        ...milk,
        status: "purchased",
        purchased_at: "2026-10-29T10:00:00Z",
      }),
      [`POST ${SHOP}/lists/${groceries.id}/restock`]: () => {
        restocked = true;
        return Response.json({ count: 1 });
      },
    });
    await renderSignedIn(<ShoppingPanel />);

    await user.click(await screen.findByRole("checkbox", { name: "Milk" }));

    const bought = await screen.findByRole("list", { name: "1 bought" });
    expect(within(bought).getByRole("checkbox", { name: "Milk" })).toBeChecked();
    expect(screen.getByRole("list", { name: "1 item to buy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Groceries, 1 to buy" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restock all" }));

    expect(await screen.findByRole("list", { name: "2 items to buy" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /bought/ })).not.toBeInTheDocument();
    expect(restocked).toBe(true);
  });

  it("restores an item when marking it bought fails", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`POST ${SHOP}/items/${milk.id}/purchase`]: status(503),
    });
    await renderSignedIn(<ShoppingPanel />);

    await user.click(await screen.findByRole("checkbox", { name: "Milk" }));

    const message = await screen.findByText(/database is unavailable/);
    expect(message.closest("[role=alert]")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Milk" })).not.toBeChecked();
  });

  it("edits an item's details and clears its link", async () => {
    const user = userEvent.setup();
    const patched: unknown[] = [];
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`PATCH ${SHOP}/items/${eggs.id}`]: ({ body }: MockRequest) => {
        patched.push(body);
        return Response.json({ ...eggs, quantity: "12", url: null, notes: "Free range" });
      },
    });
    await renderSignedIn(<ShoppingPanel />);

    await user.click(await screen.findByRole("button", { name: "Edit “Eggs”" }));
    const dialog = screen.getByRole("dialog", { name: "Edit item" });
    await user.type(within(dialog).getByRole("textbox", { name: "Quantity" }), "12");
    await user.clear(within(dialog).getByRole("textbox", { name: "Link" }));
    await user.type(within(dialog).getByRole("textbox", { name: /Notes/ }), "Free range");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patched).toEqual([{ quantity: "12", url: null, notes: "Free range" }]);
    expect(screen.getByText("Free range")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/ })).not.toBeInTheDocument();
  });

  it("creates a list and switches to it", async () => {
    const user = userEvent.setup();
    const gifts = list({ id: "l-gifts", name: "Gifts" });
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`POST ${SHOP}/lists`]: json(gifts, 201),
      [`GET ${SHOP}/lists/${gifts.id}/items`]: json({ items: [] }),
    });
    await renderSignedIn(<ShoppingPanel />);
    await screen.findByRole("checkbox", { name: "Milk" });

    await user.click(screen.getByRole("button", { name: "New list" }));
    const dialog = screen.getByRole("dialog", { name: "New shopping list" });
    await user.type(within(dialog).getByRole("textbox", { name: "List name" }), "Gifts{Enter}");

    expect(await screen.findByRole("heading", { name: "Gifts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gifts, 0 to buy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await screen.findByRole("heading", { name: "Nothing on this list yet" })).toBeVisible();
  });

  it("deletes a list after confirmation and returns to the default list", async () => {
    const user = userEvent.setup();
    let deleted = false;
    mockApi({
      ...session,
      ...listsRoute,
      ...itemsRoutes,
      [`DELETE ${SHOP}/lists/${electronics.id}`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });
    await renderSignedIn(<ShoppingPanel />);
    await user.click(await screen.findByRole("button", { name: "Electronics, 1 to buy" }));
    await screen.findByRole("checkbox", { name: "USB-C cable" });

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete list" }));

    expect(await screen.findByRole("heading", { name: "Groceries" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Electronics/ })).not.toBeInTheDocument();
    expect(deleted).toBe(true);
  });

  it("offers a retry when the lists fail to load", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockApi({
      ...session,
      ...itemsRoutes,
      [`GET ${SHOP}/lists`]: () =>
        fail ? new Response(null, { status: 500 }) : Response.json({ lists: [groceries] }),
    });
    await renderSignedIn(<ShoppingPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t load your shopping lists.",
    );
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("checkbox", { name: "Milk" })).toBeInTheDocument();
  });
});
