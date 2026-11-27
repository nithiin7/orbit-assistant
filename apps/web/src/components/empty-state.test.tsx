import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ListTodo } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("shows the title and one-line explanation, with a decorative illustration", () => {
    const { container } = render(
      <EmptyState icon={ListTodo} title="No tasks yet" description="Add your first task above." />,
    );

    expect(screen.getByRole("heading", { name: "No tasks yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first task above.")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true'] svg")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("offers templates through a button after the module's own action", async () => {
    const user = userEvent.setup();
    const onTemplates = vi.fn();
    render(
      <EmptyState
        icon={ListTodo}
        title="No tasks yet"
        description="Add your first task above."
        template={{ onClick: onTemplates }}
      >
        <Button>New task</Button>
      </EmptyState>,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "New task",
      "Start from a template",
    ]);
    await user.click(screen.getByRole("button", { name: "Start from a template" }));
    expect(onTemplates).toHaveBeenCalledOnce();
  });

  it("links to a templates view when given an address", () => {
    render(
      <EmptyState
        icon={ListTodo}
        title="No habits yet"
        description="Create a habit to track it each day."
        template={{ href: "/habits?view=templates" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Start from a template" })).toHaveAttribute(
      "href",
      "/habits?view=templates",
    );
  });
});
