import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { useModalDialog } from "./use-modal-dialog";

function Dialog({ onClose, dismissible }: { onClose: () => void; dismissible?: boolean }) {
  const { close, dialogProps } = useModalDialog({ onClose, dismissible });
  return (
    <dialog {...dialogProps} aria-label="Example">
      <button type="button" onClick={close}>
        Done
      </button>
    </dialog>
  );
}

function renderOpenedFrom(dialog: ReactElement) {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  render(dialog);
  return opener;
}

describe("useModalDialog", () => {
  it("opens on mount, then returns focus and reports when it closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = renderOpenedFrom(<Dialog onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(dialog).toHaveAttribute("open");

    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(dialog).not.toHaveAttribute("open");
    expect(onClose).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("closes on a backdrop click only while dismissible", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Dialog onClose={onClose} dismissible={false} />);
    const dialog = screen.getByRole("dialog", { name: "Example" });

    await user.click(dialog);
    expect(dialog).toHaveAttribute("open");

    rerender(<Dialog onClose={onClose} />);
    await user.click(dialog);
    expect(dialog).not.toHaveAttribute("open");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
