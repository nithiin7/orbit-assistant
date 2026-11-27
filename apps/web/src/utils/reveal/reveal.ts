/**
 * A ref callback that sets `data-in-view` on the element the first time a good part of it
 * scrolls into view, so CSS can hold an entrance animation until then (see `progress-arc`).
 * Without IntersectionObserver the element counts as in view at once.
 */
export function revealWhenVisible(element: Element | null): (() => void) | undefined {
  if (!element) return undefined;
  if (typeof IntersectionObserver === "undefined") {
    element.setAttribute("data-in-view", "");
    return undefined;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      element.setAttribute("data-in-view", "");
      observer.disconnect();
    },
    { threshold: 0.4 },
  );
  observer.observe(element);
  return () => observer.disconnect();
}
