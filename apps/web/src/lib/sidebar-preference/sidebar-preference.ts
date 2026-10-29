/**
 * The desktop sidebar's collapsed state lives on `<html data-sidebar>` so CSS can style it before
 * React hydrates. The preference is saved per browser in localStorage.
 */
export const SIDEBAR_STORAGE_KEY = "orbit:sidebar";

/** Inline script for the root layout's <head>: applies the saved preference before first paint. */
export const sidebarPreferenceScript = `try{if(localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)})==="collapsed")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`;

export function readSidebarCollapsed(root: HTMLElement = document.documentElement): boolean {
  return root.dataset.sidebar === "collapsed";
}

export function writeSidebarCollapsed(
  collapsed: boolean,
  root: HTMLElement = document.documentElement,
) {
  const value = collapsed ? "collapsed" : "expanded";
  root.dataset.sidebar = value;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The preference then lasts
    // only for this page view, which is an acceptable degradation.
  }
}
