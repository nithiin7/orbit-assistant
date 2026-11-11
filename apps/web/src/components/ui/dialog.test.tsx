import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useModalDialog } from "@/hooks/use-modal-dialog";

import { Dialog, DialogFormActions, DialogHeader } from "./dialog";

function Example({
  busy = false,
  description,
  onClose,
}: {
  busy?: boolean;
  description?: ReactNode;
  onClose: () => void;
}) {
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !busy });
  return (
    <Dialog {...dialogProps} aria-labelledby="heading" className="mt-[10vh] max-w-sm">
      <form noValidate onSubmit={(event) => event.preventDefault()}>
        <DialogHeader
          titleId="heading"
          title="Rename list"
          description={description}
          onClose={close}
        />
        <DialogFormActions busy={busy} onCancel={close} submitLabel="Rename" />
      </form>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("is a modal named by its heading, with its own size on top of the shared frame", () => {
    render(<Example onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Rename list" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("dialog-pop", "rounded-xl", "mt-[10vh]", "max-w-sm");
  });

  it("closes from the close button and from Cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<Example onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(<Example onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows a description under the title when given", () => {
    render(<Example description={<p>Lists keep tasks apart.</p>} onClose={() => {}} />);

    expect(screen.getByText("Lists keep tasks apart.")).toBeInTheDocument();
  });

  it("disables both actions and shows progress while busy", () => {
    render(<Example busy onClose={() => {}} />);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
