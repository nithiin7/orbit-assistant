import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS, type ToastOptions, ToastProvider, useToast } from "@/providers/toast";

import { Toaster } from "./toaster";

function Trigger({ options }: { options: ToastOptions[] }) {
  const { show } = useToast();
  return (
    <>
      {options.map((option) => (
        <button key={option.message} type="button" onClick={() => show(option)}>
          Show {option.message}
        </button>
      ))}
    </>
  );
}

function renderToaster(options: ToastOptions[]) {
  return render(
    <ToastProvider>
      <Trigger options={options} />
      <Toaster />
    </ToastProvider>,
  );
}

describe("Toaster", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs the action on Undo and never expires it", () => {
    const onAction = vi.fn();
    const onExpire = vi.fn();
    renderToaster([{ message: "Deleted “Milk”.", action: { label: "Undo", onAction }, onExpire }]);

    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));
    expect(screen.getByText("Deleted “Milk”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Deleted “Milk”.")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("expires once when it times out, and not while hovered", () => {
    const onExpire = vi.fn();
    renderToaster([{ message: "Deleted “Milk”.", onExpire }]);
    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));

    const toast = screen.getByText("Deleted “Milk”.").parentElement!;
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2));
    expect(onExpire).not.toHaveBeenCalled();

    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(onExpire).toHaveBeenCalledOnce();
    expect(screen.queryByText("Deleted “Milk”.")).not.toBeInTheDocument();
  });

  it("expires the toast on screen when a newer one replaces it", () => {
    const first = vi.fn();
    const second = vi.fn();
    renderToaster([
      { message: "Deleted “Milk”.", onExpire: first },
      { message: "Deleted “Eggs”.", onExpire: second },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));
    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Eggs”." }));

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(screen.queryByText("Deleted “Milk”.")).not.toBeInTheDocument();
    expect(screen.getByText("Deleted “Eggs”.")).toBeInTheDocument();
  });

  it("expires pending work when the page is left or the provider unmounts", () => {
    const onExpire = vi.fn();
    const { unmount } = renderToaster([{ message: "Deleted “Milk”.", onExpire }]);
    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(onExpire).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));
    unmount();
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape without running the action", () => {
    const onAction = vi.fn();
    const onExpire = vi.fn();
    renderToaster([{ message: "Deleted “Milk”.", action: { label: "Undo", onAction }, onExpire }]);
    fireEvent.click(screen.getByRole("button", { name: "Show Deleted “Milk”." }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Undo" }), { key: "Escape" });

    expect(onExpire).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });
});
