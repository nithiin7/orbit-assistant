import {
  canHideNavItem,
  type NavGroupId,
  navGroups,
  navItemKey,
  sidebarSections,
} from "@/lib/navigation";

/**
 * Which sidebar links are hidden and which sections are folded. Like the sidebar's collapsed
 * state, both live on `<html>` (`data-nav-hidden`, `data-nav-folded`, as space-separated keys) so
 * the CSS from `navPreferenceStyles` applies them before React hydrates, and are saved per browser
 * in localStorage.
 */
export const NAV_STORAGE_KEY = "orbit:nav";

export type NavPreference = {
  /** Keys (see `navItemKey`) of links left out of the sidebar. */
  hidden: readonly string[];
  /** Sections showing only their heading (and the current page, if it's in one). */
  folded: readonly NavGroupId[];
};

/** Inline script for the root layout's <head>: applies the saved preference before first paint. */
export const navPreferenceScript = `try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(NAV_STORAGE_KEY)})||"{}"),d=document.documentElement.dataset;if(Array.isArray(p.hidden))d.navHidden=p.hidden.join(" ");if(Array.isArray(p.folded))d.navFolded=p.folded.join(" ")}catch(e){}`;

/**
 * Static CSS for the root layout: hides what the preference hides until React renders the sidebar
 * from it. After hydration React leaves these items out itself, so the rules only cover first paint.
 */
export const navPreferenceStyles = sidebarSections
  // Sections with a link that can't be hidden (the dashboard's) have no heading to fold either.
  .filter((section) => section.label !== null && section.items.every(canHideNavItem))
  .flatMap((section) => {
    const keys = section.items.map(navItemKey);
    const hideAll = keys.map((key) => `[data-nav-hidden~="${key}"]`).join("");
    return [
      ...keys.map((key) => `[data-nav-hidden~="${key}"] [data-nav-item="${key}"]`),
      // A section whose links are all hidden loses its heading too.
      `html${hideAll} [data-nav-group="${section.id}"]`,
      // Folded sections keep the current page; the collapsed (icon) sidebar ignores folding.
      `html[data-nav-folded~="${section.id}"]:not([data-sidebar="collapsed"]) [data-nav-group="${section.id}"] [data-nav-item]:not(:has([aria-current]))`,
    ];
  })
  .join(",")
  .concat("{display:none}");

const groupIds: ReadonlySet<string> = new Set(navGroups.map((group) => group.id));

function parseKeys(value: string | undefined): string[] {
  return value ? value.split(" ").filter(Boolean) : [];
}

let cached: { hidden: string; folded: string; value: NavPreference } | null = null;

/** Reads the preference from `<html>`; returns the same object until it changes. */
export function readNavPreference(root: HTMLElement = document.documentElement): NavPreference {
  const hidden = root.dataset.navHidden ?? "";
  const folded = root.dataset.navFolded ?? "";
  if (cached?.hidden !== hidden || cached.folded !== folded) {
    cached = {
      hidden,
      folded,
      value: {
        hidden: parseKeys(hidden),
        folded: parseKeys(folded).filter((id): id is NavGroupId => groupIds.has(id)),
      },
    };
  }
  return cached.value;
}

export function writeNavPreference(
  preference: NavPreference,
  root: HTMLElement = document.documentElement,
) {
  root.dataset.navHidden = preference.hidden.join(" ");
  root.dataset.navFolded = preference.folded.join(" ");
  try {
    localStorage.setItem(
      NAV_STORAGE_KEY,
      JSON.stringify({ hidden: preference.hidden, folded: preference.folded }),
    );
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The preference then lasts
    // only for this page view, which is an acceptable degradation.
  }
}
