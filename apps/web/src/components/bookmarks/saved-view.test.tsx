import type { Bookmark, BookmarkCollection } from "@orbit/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { SavedPanel } from "./saved-view";

// The view comes from the URL; each test picks its own.
let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/saved",
  useSearchParams: () => search,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const BM = `/api/v1/workspaces/${personal.id}/bookmarks`;

function bookmark(overrides: Partial<Bookmark> & Pick<Bookmark, "id" | "title">): Bookmark {
  return {
    collection_id: null,
    url: `https://example.com/${overrides.id}`,
    note: "",
    kind: "link",
    status: "reference",
    tags: [],
    pinned: false,
    open_count: 0,
    last_opened_at: null,
    preview_description: null,
    has_image: false,
    has_icon: false,
    previewed_at: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies Bookmark;
}

const recipes: BookmarkCollection = {
  id: "c-recipes",
  name: "Recipes",
  color: "rose",
  position: 0,
  bookmarks: 1,
};

/** Stateful lists, so mutations that refetch see their changes. */
function routes(
  initial: Bookmark[],
  collections: BookmarkCollection[] = [],
  { previews = false }: { previews?: boolean } = {},
) {
  let items = initial;
  return {
    set: (next: Bookmark[]) => {
      items = next;
    },
    route: {
      [`GET ${BM}/items`]: () => Response.json({ bookmarks: items }),
      [`GET ${BM}/collections`]: () => Response.json({ collections }),
      [`GET ${BM}/settings`]: () => Response.json({ previews_enabled: previews }),
    },
  };
}

afterEach(() => {
  search = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  localStorage.clear();
});

describe("SavedPanel", () => {
  it("saves a first link with only its address", async () => {
    const user = userEvent.setup();
    const store = routes([]);
    const sent: unknown[] = [];
    mockApi({
      ...session,
      ...store.route,
      [`POST ${BM}/items`]: (request: MockRequest) => {
        sent.push(request.body);
        const saved = bookmark({
          id: "b-reel",
          title: "instagram.com · C1abc",
          url: "https://www.instagram.com/reel/C1abc/",
          kind: "reel",
          status: "later",
        });
        store.set([saved]);
        return Response.json(saved, { status: 201 });
      },
    });

    await renderSignedIn(<SavedPanel />);

    await user.click(await screen.findByRole("button", { name: "Save a link" }));
    const dialog = await screen.findByRole("dialog", { name: "Save a link" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Link" }),
      "https://www.instagram.com/reel/C1abc/",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save link" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(sent).toEqual([
      {
        url: "https://www.instagram.com/reel/C1abc/",
        title: null,
        note: "",
        kind: null,
        status: null,
        tags: [],
        pinned: false,
        collection_id: null,
      },
    ]);
    const list = await screen.findByRole("list", { name: "All links" });
    expect(within(list).getByText("instagram.com · C1abc")).toBeInTheDocument();
    expect(within(list).getByText("Later")).toBeInTheDocument();
  });

  it("rejects an address that isn't a web link", async () => {
    const user = userEvent.setup();
    mockApi({ ...session, ...routes([]).route });

    await renderSignedIn(<SavedPanel />);

    await user.click(await screen.findByRole("button", { name: "Save a link" }));
    const dialog = await screen.findByRole("dialog", { name: "Save a link" });
    await user.type(within(dialog).getByRole("textbox", { name: "Link" }), "javascript:alert(1)");
    await user.click(within(dialog).getByRole("button", { name: "Save link" }));

    expect(
      await within(dialog).findByText("Use a web address starting with http:// or https://."),
    ).toBeInTheDocument();
  });

  it("shows pinned links to launch, opens links in a new tab, and counts opens", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    const grafana = bookmark({
      id: "b-grafana",
      title: "Grafana",
      url: "https://grafana.example.com/d/abc",
      pinned: true,
      kind: "tool",
    });
    mockApi({
      ...session,
      ...routes([grafana, bookmark({ id: "b-pasta", title: "Pasta" })]).route,
      [`POST ${BM}/items/b-grafana/opened`]: () => {
        opened.push("b-grafana");
        return Response.json({ ...grafana, open_count: 1 });
      },
    });

    await renderSignedIn(<SavedPanel />);

    const launch = await screen.findByRole("region", { name: "Quick launch" });
    const tile = within(launch).getByRole("link", { name: /Grafana/ });
    expect(tile).toHaveAttribute("href", "https://grafana.example.com/d/abc");
    expect(tile).toHaveAttribute("target", "_blank");
    expect(tile).toHaveAttribute("rel", "noopener noreferrer");
    // jsdom doesn't navigate; the click still counts the open.
    tile.addEventListener("click", (event) => event.preventDefault());
    await user.click(tile);
    await waitFor(() => expect(opened).toEqual(["b-grafana"]));
  });

  it("filters the list as you type", async () => {
    const user = userEvent.setup();
    mockApi({
      ...session,
      ...routes([
        bookmark({ id: "b-1", title: "Grafana", note: "Prod dashboards" }),
        bookmark({ id: "b-2", title: "Pasta", tags: ["recipes"] }),
      ]).route,
    });

    await renderSignedIn(<SavedPanel />);

    const list = await screen.findByRole("list", { name: "All links" });
    await user.type(screen.getByRole("searchbox", { name: "Filter links" }), "dashboards");
    expect(within(list).getByText("Grafana")).toBeInTheDocument();
    expect(within(list).queryByText("Pasta")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Filter links" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter links" }), "nothing like it");
    expect(await screen.findByText("No links match")).toBeInTheDocument();
  });

  it("saves a link pasted onto the page", async () => {
    const store = routes([]);
    const sent: { url: string }[] = [];
    mockApi({
      ...session,
      ...store.route,
      [`POST ${BM}/items`]: (request: MockRequest) => {
        const body = request.body as { url: string };
        sent.push(body);
        const saved = bookmark({ id: "b-new", title: "example.com · recipe", url: body.url });
        store.set([saved]);
        return Response.json(saved, { status: 201 });
      },
    });

    await renderSignedIn(<SavedPanel />);
    await screen.findByRole("button", { name: "Save a link" });

    fireEvent.paste(document.body, {
      clipboardData: { getData: () => "  https://example.com/recipe  " },
    });

    await waitFor(() =>
      expect(sent.map((body) => body.url)).toEqual(["https://example.com/recipe"]),
    );
    expect(await screen.findByText("example.com · recipe")).toBeInTheDocument();
  });

  it("ignores pasted text that isn't a link", async () => {
    let posts = 0;
    mockApi({
      ...session,
      ...routes([]).route,
      [`POST ${BM}/items`]: () => {
        posts += 1;
        return new Response(null, { status: 500 });
      },
    });

    await renderSignedIn(<SavedPanel />);
    await screen.findByRole("button", { name: "Save a link" });
    fireEvent.paste(document.body, { clipboardData: { getData: () => "just some words" } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts).toBe(0);
  });

  it("opens Save a link filled in from the command palette", async () => {
    search = new URLSearchParams("add=https://example.com/from-palette");
    mockApi({ ...session, ...routes([]).route });

    await renderSignedIn(<SavedPanel />);

    const dialog = await screen.findByRole("dialog", { name: "Save a link" });
    expect(within(dialog).getByRole("textbox", { name: "Link" })).toHaveValue(
      "https://example.com/from-palette",
    );
  });

  it("marks a later link done from its menu", async () => {
    const user = userEvent.setup();
    const reel = bookmark({ id: "b-reel", title: "Knife skills", kind: "reel", status: "later" });
    const patches: unknown[] = [];
    mockApi({
      ...session,
      ...routes([reel]).route,
      [`PATCH ${BM}/items/b-reel`]: (request: MockRequest) => {
        patches.push(request.body);
        return Response.json({ ...reel, status: "done" });
      },
    });

    await renderSignedIn(<SavedPanel />);

    await user.click(await screen.findByRole("button", { name: "Actions for Knife skills" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as done" }));

    await waitFor(() => expect(patches).toEqual([{ status: "done" }]));
    expect(await screen.findByText("Done")).toBeInTheDocument();
  });

  it("shows a collection's links and deletes the collection, keeping them", async () => {
    const user = userEvent.setup();
    search = new URLSearchParams("collection=c-recipes");
    let deleted = false;
    mockApi({
      ...session,
      ...routes(
        [
          bookmark({ id: "b-pasta", title: "Pasta", collection_id: "c-recipes" }),
          bookmark({ id: "b-other", title: "Other" }),
        ],
        [recipes],
      ).route,
      [`DELETE ${BM}/collections/c-recipes`]: () => {
        deleted = true;
        return new Response(null, { status: 204 });
      },
    });

    await renderSignedIn(<SavedPanel />);

    expect(await screen.findByRole("heading", { name: "Recipes", level: 2 })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Recipes" });
    expect(within(list).getByText("Pasta")).toBeInTheDocument();
    expect(within(list).queryByText("Other")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for the Recipes collection" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete collection" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Delete collection" }));

    await waitFor(() => expect(deleted).toBe(true));
    expect(replace).toHaveBeenCalledWith("/saved");
  });

  it("creates a collection from the rail", async () => {
    const user = userEvent.setup();
    const created: unknown[] = [];
    mockApi({
      ...session,
      ...routes([bookmark({ id: "b-1", title: "One" })]).route,
      [`POST ${BM}/collections`]: (request: MockRequest) => {
        created.push(request.body);
        return Response.json({ ...recipes, bookmarks: 0 }, { status: 201 });
      },
    });

    await renderSignedIn(<SavedPanel />);
    await screen.findByRole("list", { name: "All links" });

    await user.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    await user.type(within(dialog).getByRole("textbox", { name: "Collection name" }), "Recipes");
    await user.click(within(dialog).getByRole("button", { name: "Create collection" }));

    await waitFor(() => expect(created).toEqual([{ name: "Recipes", color: "blue" }]));
    expect(push).toHaveBeenCalledWith("/saved?collection=c-recipes");
  });

  it("offers a retry when the links can't load", async () => {
    mockApi({
      ...session,
      [`GET ${BM}/items`]: status(500),
      [`GET ${BM}/collections`]: json({ collections: [] }),
    });

    await renderSignedIn(<SavedPanel />);

    expect(await screen.findByText("Couldn’t load your saved links.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  describe("link previews", () => {
    it("fetches a preview after saving when previews are on", async () => {
      const user = userEvent.setup();
      const store = routes([], [], { previews: true });
      const saved = bookmark({
        id: "b-yt",
        title: "youtube.com · watch",
        url: "https://www.youtube.com/watch?v=abc",
        kind: "video",
        status: "later",
      });
      const previewed = {
        ...saved,
        title: "How to sharpen a knife",
        preview_description: "A five minute guide.",
        previewed_at: "2026-11-10T10:00:00Z",
      };
      const previewCalls: string[] = [];
      mockApi({
        ...session,
        ...store.route,
        [`POST ${BM}/items`]: () => {
          store.set([saved]);
          return Response.json(saved, { status: 201 });
        },
        [`POST ${BM}/items/b-yt/preview`]: () => {
          previewCalls.push("b-yt");
          store.set([previewed]);
          return Response.json(previewed);
        },
      });

      await renderSignedIn(<SavedPanel />);

      await user.click(await screen.findByRole("button", { name: "Save a link" }));
      const dialog = await screen.findByRole("dialog", { name: "Save a link" });
      expect(dialog).toHaveTextContent("Orbit fetches the page’s name, description, and image");
      await user.type(
        within(dialog).getByRole("textbox", { name: "Link" }),
        "https://www.youtube.com/watch?v=abc",
      );
      await user.click(within(dialog).getByRole("button", { name: "Save link" }));

      expect(await screen.findByText("How to sharpen a knife")).toBeInTheDocument();
      expect(screen.getByText("A five minute guide.")).toBeInTheDocument();
      expect(previewCalls).toEqual(["b-yt"]);
    });

    it("offers previews in Settings when they're off, and never fetches one", async () => {
      const user = userEvent.setup();
      let previewCalls = 0;
      mockApi({
        ...session,
        ...routes([bookmark({ id: "b-1", title: "One" })]).route,
        [`POST ${BM}/items/b-1/preview`]: () => {
          previewCalls += 1;
          return new Response(null, { status: 409 });
        },
      });

      await renderSignedIn(<SavedPanel />);

      await user.click(await screen.findByRole("button", { name: "Actions for One" }));
      expect(screen.queryByRole("menuitem", { name: /preview/i })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Save link" }));
      const dialog = await screen.findByRole("dialog", { name: "Save a link" });
      expect(within(dialog).getByRole("link", { name: "Turn on link previews" })).toHaveAttribute(
        "href",
        "/settings/saved",
      );
      expect(previewCalls).toBe(0);
    });

    it("refreshes a preview from the menu and reports failures", async () => {
      const user = userEvent.setup();
      mockApi({
        ...session,
        ...routes([bookmark({ id: "b-1", title: "One" })], [], { previews: true }).route,
        [`POST ${BM}/items/b-1/preview`]: () =>
          Response.json({ detail: "Couldn't get a preview from that page." }, { status: 502 }),
      });

      await renderSignedIn(<SavedPanel />);

      await user.click(await screen.findByRole("button", { name: "Actions for One" }));
      await user.click(await screen.findByRole("menuitem", { name: "Refresh preview" }));

      expect(await screen.findByText("Couldn't get a preview from that page.")).toBeInTheDocument();
    });
  });
});
