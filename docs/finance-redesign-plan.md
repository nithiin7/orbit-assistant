# Finance redesign plan

Status: **implemented, not yet committed** (planned and built 2026-10-31). See
[Outcome](#8-outcome) for the decisions taken and where the build differs from this plan.

This plan brings `apps/web/src/components/finance` (13 tabs, about 30 files) in line with the
Tasks, Shopping, and Reminders redesigns (`52daa83`, `36ec559`, `f23a5b4`). Each phase below is
one reviewable commit. A later session should be able to pick up any phase from this document,
the "before" screenshots, and those three commits' diffs.

## Contents

1. [What the redesigned pages established](#1-what-the-redesigned-pages-established)
2. [Audit](#2-audit)
3. [Navigation for 13 views](#3-navigation-for-13-views)
4. [Shared finance building blocks](#4-shared-finance-building-blocks)
5. [Phases](#5-phases)
6. [Screenshots and the preview setup](#6-screenshots-and-the-preview-setup)
7. [Open questions](#7-open-questions)

---

## 1. What the redesigned pages established

Read `git show 52daa83 36ec559 f23a5b4` before starting a phase. The system to reuse:

- **Container queries, not screen breakpoints.** A page root `@container/<page>`, a sticky side
  rail from `@4xl`, `@container/list` for the main column, and `@container/rows` for row lists.
  The app sidebar takes a varying share of the screen, so `sm:`/`lg:`/`xl:` measure the wrong
  thing. Finance uses only screen breakpoints today.
- **360 px through 4K.** Use extra width for columns, side panels, or multi-column lists
  (Tasks: `@5xl/list:columns-2`, `@min-[100rem]/list:columns-3`), not for stretched rows.
- **One primary action per view.** Several "add" actions go in a `Menu` (`ui/menu.tsx`). Row
  actions stay quiet: one visible action at most, the rest behind an overflow menu or on the
  row itself.
- **Views in a rail** (`tasks/task-views.tsx`): `aria-pressed` buttons with an icon, label, and
  count. A column from `@4xl`, a sideways-scrolling row below that.
- **Sections with uppercase headings and counts** (Tasks' due-date groups, Reminders' fire-time
  sections), colored only where they mean something (overdue is red, today uses the brand color).
- **Chips for metadata** (`tasks/task-meta.tsx`, `reminders/reminder-meta.tsx`): small rounded
  chips beside the title from `@2xl/rows`, below it on narrow rows.
- **States:** loading skeletons shaped like the content, a `role="alert"` error with a retry,
  helpful empty states, and an `sr-only` live region for announcements.

## 2. Audit

The "before" screenshots are in [`docs/finance-redesign/before/`](finance-redesign/before/)
(`<tab>-<width>.webp` at 390, 1280, and 2560 px, plus two dark ones). They were taken with
realistic seeded data; see [section 6](#6-screenshots-and-the-preview-setup).

### 2.1 Problems shared by every tab

| #   | Problem                                                                                                                                                                                                                                                                                         | Seen in                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| G1  | **The 13-tab strip doesn't fit anywhere.** At 390 px about 4 tabs are visible; at 1280 px, 8. You have to scroll sideways to find Loans or Net worth, and nothing shows how the tabs relate. Only at 2560 px does the whole strip fit.                                                          | every `*-390`, `*-1280`                           |
| G2  | **Three equal "Income / Expense / Transfer" buttons on every tab**, even on Goals or Net worth, where the tab has its own primary action ("Add goal"). That's 4–5 competing buttons per view. On phones they take a full row under the tabs.                                                    | every tab                                         |
| G3  | **The selected tab isn't in the URL.** Reloading always lands on Overview; links, Back, and the command palette can't open a tab. The Overview's "Budgets →" links only switch React state.                                                                                                     | `finance-view.tsx`                                |
| G4  | **Screen breakpoints, not container queries.** Grids use `sm:`/`lg:`/`xl:`. At 2560 px the content is 1,900 px wide and rows stretch: a name on the far left and its amount 1,600 px away (Accounts, Upcoming, Net worth's "What's counted").                                                   | `accounts-2560`, `net-worth-2560`                 |
| G5  | **Summary tiles sized for three.** A tab with one figure (Accounts, Goals, Subscriptions, Bills) shows one tile in a third of the width with empty space beside it. Tiles are built five different ways (see [4](#4-shared-finance-building-blocks)).                                           | `goals-2560`, `bills-1280`                        |
| G6  | **Rows show every action as a button.** Budgets: History, Edit, Archive, Delete. Goals: Add money, Withdraw, History, Edit, Pause, Mark complete, Cancel (7). Subscriptions/Bills: 6. Holdings: Buy, Sell, Update NAV, Dividend, Schedule SIP, Edit. On phones these wrap to two lines per row. | `budgets-1280`, `goals-2560`, `subscriptions-390` |
| G7  | **Month and currency controls are repeated per tab and don't share state.** Overview, Budgets, and Plan each have their own month; moving to October on Budgets and then opening Plan resets to this month. Currency appears as `CurrencyPicker` on three tabs and `InlineSelect` on two.       | `budget-parts.tsx`, `investment-parts.tsx`        |
| G8  | **No view headings.** Some tabs have an `h2` ("Budgets", "Loans"), some start with tiles, Transactions has only an `sr-only` heading. The page `h1` is always "Finance", and its description talks only about accounts and transfers.                                                           | all                                               |
| G9  | **Error and loading blocks are copied by hand.** 22 inline `role="alert"` retry blocks across 14 files; `ErrorPanel` lives in `investments-view.tsx` and `Panel`/`Tile` in `finance-overview.tsx`, and other views import them from there.                                                      | code                                              |
| G10 | **Archived and ended items** use five similar hand-built `<details>` blocks (accounts, budgets, goals, loans, recurring).                                                                                                                                                                       | code                                              |

### 2.2 Per tab

**Overview** (`finance-overview.tsx`, `commitments-summary.tsx`, `budget-summary.tsx`,
`finance-charts.tsx`)

- Layout: month navigator, then three cash-flow tiles, a Commitments card with four figures,
  Budget and Savings goals cards side by side, a trend chart and category bars, then account
  balances and the latest transactions. It's a long, single-column dashboard.
- **Phone bug:** the _Account balances_ panel overflows the screen (content reaches 670 px at
  390 px), cutting off "Owed on cards and loans" and the latest transactions' accounts
  (`overview-390`). The grid item lacks `min-w-0`.
- Wide: the four Commitments figures spread across 1,900 px; the trend chart's bars sit far
  apart; the balances list runs to 11 rows and sets the height of the bottom row.
- UX: the balances list repeats the Accounts tab. Sections don't say which tab they summarize,
  except for the arrow links in two cards. Everything is the same weight, so nothing reads as the
  headline.

**Budgets** (`budgets-view.tsx` 737 lines, `budget-parts.tsx`, `budget-dialog.tsx`)

- Layout: month navigator with Copy and Add buttons, three tiles, an unlabelled full-width
  utilization bar, the budget list, then "Spending by category" and "Budget against spending"
  side by side, then a `<details>` of ended budgets.
- UX: the overall bar right under the tiles reads as a divider. Each row shows four actions.
  "Copy Sept" is a second header button competing with "Add budget" (and G2). Category spending
  and month history sit below the fold even on 2560 px, where there's room beside the list.

**Plan** (`plan-view.tsx`)

- Layout: two tiles, then a three-column table (line, planned, actual) beside an expected-income
  form and a "Spending and allocations" card.
- **Phone:** the table is cramped. Hints wrap to four lines in a 90 px column ("Your overall
  budget, less the month's commitment spending"), and the remaining figure's minus sign breaks
  onto its own line (`plan-390`).
- UX: the expected-income form is the only input on the tab but sits low and to the side. The
  "Left over so far" tile can be strongly negative after goal allocations and needs context.

**Goals** (`goals-view.tsx`, `goal-dialogs.tsx`)

- Layout: one tile per currency, a heading with "Add goal", then a 2-column card grid from
  `lg`, and a `<details>` of finished goals.
- UX: each card repeats the same "Kept in SBI Savings … Goals in this account count on
  ₹3,20,000.00, more than it holds" warning, three times on one screen. Seven actions per card
  (G6). At 2560 px there are still only two columns, with lots of empty space.

**Upcoming** (`upcoming-payments.tsx`)

- The closest to the new style already: three filter selects, then Overdue and Upcoming groups
  with totals, and rows with an icon, name, meta, amount, status badge, and "Record".
- UX: the "Upcoming" badge on every row inside the Upcoming group is redundant. There's no
  grouping by time (this week, later), unlike Tasks and Reminders. **Stress case:** a loan
  seeded with 13 unpaid EMIs produced a 10,000 px phone page
  (`before/stress-upcoming-overdue-emis-390.webp`); the overdue group needs a cap with "show
  all".

**Transactions** (`transaction-history.tsx`, `transaction-item.tsx`)

- Layout: a search bar with Export, a grid of six labelled filters (two columns on phones,
  six on `xl`), a paged list of 50, and a pager.
- **Phone:** the filters take a whole screen before the first transaction. Every row has a
  visible delete button. The list is 4,600 px tall (`transactions-390`).
- Wide: one long single column; rows have no date grouping.
- UX: no days as sections; no quick type filter (income/expense/transfer) as chips, which is
  the filter people use most.

**Accounts** (`accounts-view.tsx`, `account-dialog.tsx`)

- Layout: a balances tile per currency, the account list with a "Show loan accounts" checkbox
  and "Add account", archived accounts in `<details>`, then a Categories card with an inline
  add form and removable chips.
- UX: accounts aren't grouped by type (bank, card, wallet, investment); negative balances
  (−₹96,500 in SBI Savings) have no explanation. Categories are a separate concern on the same
  tab; at 2560 px the category input is 1,400 px wide. Uses a native checkbox rather than
  `ui/checkbox.tsx`.

**Loans** (`loans-view.tsx`, `loan-dialog.tsx`, `loan-schedule-dialogs.tsx`)

- Layout: a heading with "Add loan", one card per loan (still owed with a progress bar, EMI,
  next EMI), "Show EMI schedule" and "Record EMI".
- UX: there's no summary across loans (total owed, monthly EMIs), which only the Overview has.
  "Close" in the card header reads like closing a panel; it means closing the loan. Cards are
  full width at every size.

**Subscriptions and Bills** (`recurring-view.tsx`, `recurring-dialog.tsx`; one component,
two tabs)

- Layout: a tile per currency, a heading with "Add …", rows with amount per period, the due
  date, an overdue badge, and six actions.
- **Phone:** actions wrap to two lines on every row (`subscriptions-390`).
- UX: "Renews" and "Due" mean the same thing in two words. Annual items (Amazon Prime) sort
  first because of their name, not by when they're due.

**Investments** (`investments-view.tsx` 1,006 lines, `investment-dialogs.tsx` 1,166 lines,
`investment-parts.tsx`)

- Layout: range and currency selects with an "Add" menu, four tiles, allocation and category
  bars, a Holdings panel grouped by account (each holding shows a five-column figure grid, an SIP
  strip, and six actions), a Deposits panel, then Recent activity and Investment accounts side by
  side.
- **1280 px:** the "+" of "+₹34,392.91" in the gain tiles wraps onto its own line
  (`investments-1280`).
- **Phone:** 5,700 px long; each holding is about 400 px tall (`investments-390`).
- UX: already uses `Menu` for adding, which is the pattern to keep. Holdings need a compact row
  (name, value, gain) with the detail figures on demand.

**Assets** (`assets-view.tsx`)

- Layout: an outline "Add asset" button, then one panel with rows (value, freshness badge, and
  Update value, History, Edit, Archive).
- UX: no total; the primary action is an outline button; three assets leave most of a 2560 px
  screen empty.

**Net worth** (`net-worth-view.tsx`)

- Layout: currency or "As of" line with "Save this month's snapshot", three tiles, a data
  quality note, a Change panel, a bar chart over time, asset and liability breakdowns, and a
  "What's counted" list of every item.
- Wide: the chart's six bars become 190 px blocks of nearly equal height that don't show change
  (`net-worth-2560`). "What's counted" is a 19-row list with amounts at the far edge.
- UX: snapshot saving is a top-level action but secondary to reading the numbers. The change
  figures and the chart answer the same question in two places.

### 2.3 Patterns that repeat

| Pattern                      | Where (today's implementation)                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stat tile                    | `Tile` (overview, budgets, net worth); hand-built tiles in plan, goals, recurring, accounts; `Figure` ×3 (commitments-summary, investment-parts, finance-widgets) |
| Card with title, description | `Panel` (exported from `finance-overview.tsx`, used by 5 views); hand-built `Card` headers in budget-summary, commitments-summary, plan, loans                    |
| Month / currency switcher    | `MonthNavigator`, `CurrencyPicker` (budget-parts); a copy inline in overview; `InlineSelect` (investments, net worth)                                             |
| Progress or proportion bar   | `UtilizationBar`, `ProportionBars`, `CategoryBreakdown`, goal progress, loan progress, category spending                                                          |
| Status badge                 | `PaymentStatusBadge`, `UtilizationBadge`, `FreshnessBadge`, inline `Badge`s in goals and deposits                                                                 |
| Row with actions             | transaction, budget, recurring, upcoming, holding, deposit, asset, account, investment activity                                                                   |
| Expandable row history       | budget periods, recurring occurrences, goal contributions, loan EMI schedule, asset valuations                                                                    |
| Archived/ended `<details>`   | accounts, budgets, goals, loans, recurring                                                                                                                        |
| Error with retry             | 22 inline copies plus `ErrorPanel`                                                                                                                                |
| Bar chart                    | `TrendChart` (overview), `TrendBars` (net worth)                                                                                                                  |
| Dialog                       | `DialogShell` in 8 files; `account-dialog` and `transaction-dialog` build their own `<dialog>`                                                                    |

## 3. Navigation for 13 views

### Recommendation: a grouped side rail, with a grouped picker on narrow widths

Yes to the grouped rail. Use four groups, with Overview on its own above them:

| Group           | Views                                 | Why together                                     |
| --------------- | ------------------------------------- | ------------------------------------------------ |
| _(top)_         | **Overview**                          | The landing view; summarizes every group         |
| **Money**       | Transactions, Accounts                | The ledger: what happened, and where it sits     |
| **Planning**    | Budgets, Plan, Goals                  | Looking ahead with money you control             |
| **Commitments** | Upcoming, Loans, Subscriptions, Bills | Money already promised; all feed Upcoming        |
| **Wealth**      | Investments, Assets, Net worth        | What you own and owe; Net worth totals the group |

Overview stays outside the groups because it summarizes all four. Putting it under Money would
hide that.

**Each rail item** has an icon, a label, and, where it helps, a count or a status dot taken from
data that's already loaded or cheap: Upcoming shows the overdue count (red), Budgets shows how
many are exceeded, Net worth shows a dot when values are stale. Counts are `aria-hidden`; the
view announces its own state (the same rule as `task-views.tsx`).

### Behavior by width (container queries on a `@container/finance` root)

| Container width   | Navigation                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| < `@2xl` (phones) | One full-width **section picker** button showing "Commitments · Bills" with a chevron. It opens a menu listing all 13 views under their group headings, with the same counts. Below it, the current group's views as a row of chips (2–4, so they fit at 360 px without scrolling). |
| `@2xl` – `@4xl`   | The same picker plus chips, side by side on one line.                                                                                                                                                                                                                               |
| ≥ `@4xl`          | A **sticky side rail** (`13rem`, `15rem` from `@7xl`), like Tasks: Overview, then four labelled groups. The picker and chips are hidden.                                                                                                                                            |

Why not a two-level tab bar (groups, then views) on phones? "Money / Planning / Commitments /
Wealth" needs about 340 px and doesn't fit at 360 px with page padding, so it would scroll
sideways, which is the current problem. The picker shows all 13 views in one tap and keeps
group labels visible.

The picker uses a listbox-style popover built on `use-anchored-popover` (as `ui/menu.tsx` is);
on phones it can open as a sheet. Each item is a link (see URL below), so middle-click and
long-press work.

### URL

Put the view in the URL: `/finance?view=budgets` (recommended), or `/finance/budgets` as route
segments (see [open questions](#7-open-questions)). That makes reload, Back, deep links, the
command palette, and the dashboard widgets' "View all" links land on the right view. The
default (`overview`) has no parameter. Unknown values fall back to Overview.

### Page header and the record actions

- The `h1` stays "Finance". A **view header** under it (inside the main column) gives each view
  an `h2`, one line of context ("October 2026 · INR"), its controls, and **its one primary
  action**.
- **Income / Expense / Transfer** become one **"Record"** `Menu` (Income, Expense, Refund,
  Transfer), placed in the page header's `actions` slot, so it's always in the same place.
  It's the primary button on the Money views and Overview, and the `soft` variant elsewhere,
  where the view's own "Add …" is primary. Keyboard: `N` opens it, matching Tasks and
  Shopping's `N`.
- Rewrite the page description to cover the whole area: "Accounts, spending, plans,
  commitments, and wealth, entered by hand. Private to you; Orbit never connects to your bank."

### Shared month and currency

Lift `month` and `currency` into `FinanceView` and pass them down, so Overview, Budgets, and
Plan stay on the same month, and every view uses the same currency. Views without a month
(Accounts, Loans, Investments, Net worth) ignore it. Keep "This month" one tap away.

## 4. Shared finance building blocks

Build these first (phase 1 and 2), each with tests, then convert the tabs. All of them live in
`components/finance/` unless noted. Container queries throughout.

| #   | Block                                | Replaces                                                                             | Notes                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `FINANCE_VIEWS` (in `@/lib/finance`) | the `TABS` array                                                                     | Pure data: id, label, icon name, group, and `parseFinanceView(param)`. Unit-tested. The rail, picker, URL, and command palette all read it.                                                                                                                                                                                                       |
| B2  | `FinanceNav` (`finance-nav.tsx`)     | the `ScrollStrip` of tabs                                                            | Rail ≥ `@4xl`, picker and group chips below. `aria-current="page"` on links, or `aria-pressed` if we keep buttons. Counts via a small `useFinanceNavCounts` hook that reuses cached queries (payments summary, budget month) and never blocks rendering.                                                                                          |
| B3  | `ViewHeader`                         | the per-tab header rows                                                              | `h2`, subtitle, a controls slot (month, currency, range), and one primary action. Stacks below `@3xl/list`, one line above (same as the Tasks header).                                                                                                                                                                                            |
| B4  | `MonthSwitcher`, `CurrencySwitcher`  | `MonthNavigator`, `CurrencyPicker`, `InlineSelect` (currency), the overview's copy   | Same look everywhere; `CurrencySwitcher` renders nothing for a single currency.                                                                                                                                                                                                                                                                   |
| B5  | `StatTile` + `StatGrid`              | `Tile`, the five hand-built tiles, three `Figure`s                                   | `StatGrid` uses `grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]` so one tile spans the row and four tiles fit on one line when there's room. `StatTile` supports an accent icon, tone, a sub-line, and a compact variant (no card, for inside panels). Amounts never wrap: `whitespace-nowrap` and `tabular-nums` (fixes the "+" wrap). |
| B6  | `Panel` (`panel.tsx`)                | `Panel` in `finance-overview.tsx`, hand-built card headers                           | Adds an optional header action ("Budgets →" link), `min-w-0` (fixes the Overview overflow), and `flush`.                                                                                                                                                                                                                                          |
| B7  | `LoadError`, `PanelSkeleton`         | 22 inline alerts, `ErrorPanel`, ad-hoc skeletons                                     | `LoadError` takes a message and an `onRetry`. Skeletons mimic tiles and rows.                                                                                                                                                                                                                                                                     |
| B8  | `FinanceRow` + `RowList`             | row markup in 9 places                                                               | Anatomy: leading icon chip, title (a button that opens edit), meta chips, trailing amount column, then **at most one** inline action and an overflow `Menu` ("More actions for Netflix"). `RowList` is a `@container/rows` list with optional two columns at `@5xl/list`, like Tasks.                                                             |
| B9  | `Amount`                             | ad-hoc amount spans                                                                  | Money with sign, tone (income green, overspend red), "≈" for estimates with an `sr-only` "About", and an optional period suffix ("/ month").                                                                                                                                                                                                      |
| B10 | `StatusChip` (`finance-meta.tsx`)    | `PaymentStatusBadge`, `UtilizationBadge`, `FreshnessBadge`, inline badges            | One chip style, like `task-meta.tsx`, with tone tokens: overdue, due soon, exceeded, near, on track, stale, estimate, paused, archived.                                                                                                                                                                                                           |
| B11 | `Meter`                              | `UtilizationBar`, `ProportionBars`, `CategoryBreakdown` bars, goal and loan progress | One bar with value, max, tone, and an accessible label; a labelled-list variant for breakdowns.                                                                                                                                                                                                                                                   |
| B12 | `RowDetail`                          | the History and Show-schedule toggles                                                | A disclosure inside a row: a button with `aria-expanded` and lazy content, so history loads only when opened.                                                                                                                                                                                                                                     |
| B13 | `EndedSection`                       | five `<details>` blocks                                                              | "3 archived or finished" disclosure with a `RowList` inside.                                                                                                                                                                                                                                                                                      |
| B14 | `BarChart`                           | `TrendChart`, `TrendBars`                                                            | Bars capped in width (no 190 px blocks), keyboard-focusable points with the existing tooltip, and an optional baseline that isn't zero for net worth so change is visible. Read the `dataviz` skill before building it.                                                                                                                           |
| B15 | `DialogShell` everywhere             | own `<dialog>` in `account-dialog.tsx`, `transaction-dialog.tsx`                     | Move these two onto `DialogShell` so all finance dialogs share focus, motion, and footer behavior. Dialog contents don't change.                                                                                                                                                                                                                  |

Generic pieces stay generic: if `Meter`, `StatTile`, or `RowList` are wanted outside finance
later, move them to `components/ui/` then, not now.

## 5. Phases

Each phase is one commit (scope `web`), reviewed before the next. Every phase:

- Keeps behavior and API calls the same unless the phase says otherwise. No API or contract
  changes are planned.
- Updates tests to the new structure. When an action moves into an overflow menu, the test opens
  the menu and picks the item by role and name. Never weaken or delete a test to pass.
- Runs `pnpm --filter @orbit/web exec vitest run src/components/finance`, then `pnpm check` and
  `pnpm build`.
- Takes "after" screenshots of the phase's views at 360, 390, 768, 1280, 1920, 2560, and 3840 px,
  light and dark, and compares them with `before/`. Also checks with the app sidebar collapsed,
  since that changes the container width.

### Phase 1: navigation and page frame

`feat(web): group the finance views in a side rail`

- B1, B2, B3, B4. The URL `?view=`. The Record menu in the page header. Lift month and currency
  into `FinanceView`. The `@container/finance` root and rail layout. The new page description.
- Each tab's content renders as-is inside the new main column, with its old header controls
  removed where `ViewHeader` now provides them (month, currency, and the primary "Add …").
- Fixes G1, G2, G3, G7, G8.
- Tests: view switching through rail and picker, URL sync (mock `next/navigation`), the Record
  menu, the month staying the same across Overview, Budgets, and Plan, the nav counts, and
  `parseFinanceView`.
- Risk: the biggest structural change. Keep it to the frame; don't restyle tab content.

### Phase 2: shared blocks, then the Money views and Overview

`feat(web): redesign the finance overview, transactions, and accounts`

- Build B5–B10, B15. Convert Overview, Transactions, and Accounts.
- **Overview:** a headline row (net cash flow large, income and spending beside it), then a
  responsive dashboard grid: 1 column on phones, 2 from `@3xl`, 3 from `@7xl` (cash flow
  trend, spending by category, budget, goals, commitments). Replace the 11-row balances list
  with a compact "Accounts" summary (held, owed, top 4 accounts, "All accounts →"). Fix the
  phone overflow.
- **Transactions:** search plus type chips (All, Income, Expense, Transfer, Refund) inline; the
  other filters (account, category, dates, sort) behind a "Filters" popover on narrow widths,
  showing a count of active filters, and in a filter column at `@6xl/list`. Group rows by day
  ("Today", "Yesterday", "Mon 26 Oct") with a daily net. Delete moves to the row menu. Two
  columns of rows at `@5xl/list` are **not** used here: a ledger reads top to bottom.
- **Accounts:** group by type (Bank and cash, Cards, Wallets, Investment accounts, Loans) with a
  subtotal per group; a short explanation on negative balances ("Spent more than the opening
  balance; check the opening balance"); `ui/checkbox.tsx` for "Show loan accounts". Move
  Categories into its own panel that stays narrow (`max-w-3xl`), or a collapsible section.
- Fixes G4, G5, G6, G9 for these views and the Overview overflow.

### Phase 3: Commitments

`feat(web): redesign the finance commitments views`

- B11–B13. Convert Upcoming, Loans, Subscriptions, and Bills.
- **Upcoming:** sections by time like Reminders (Overdue, This week, Later this month, Next
  month), with totals; drop the redundant "Upcoming" chip; show at most 5 overdue with "Show
  all N"; kind filter as chips, status in the filter popover. "Record" stays the row's one
  inline action.
- **Loans:** a summary row (total owed, EMIs a month, next due) via `StatGrid`; loan cards in
  a 2-column grid from `@4xl/list`; rename "Close" to "Close loan…" and move it, Reschedule,
  and Edit to the menu; "Record EMI" stays inline; the EMI schedule uses `RowDetail`.
- **Subscriptions and Bills:** sort by next due date; one word for the date ("Due", or "Renews"
  for subscriptions with auto-renew, consistently); "Record payment" inline, everything else in
  the menu; two columns of rows at `@5xl/list`.

### Phase 4: Planning

`feat(web): redesign the finance planning views`

- Convert Budgets, Plan, and Goals.
- **Budgets:** tiles plus a labelled overall `Meter`; rows show progress, chips, and the
  projection; History, Edit, Archive, and Delete go in the menu; "Copy last month" moves into
  the "Add budget" split or a `Menu`. From `@6xl/list`, a two-column layout: budgets on the left,
  category spending and the six-month history stacked on the right.
- **Plan:** the expected-income form first, as a compact inline row (amount, Save) at the top of
  the view. Replace the table on narrow widths with a stacked ledger (label, planned, actual on
  one line; hints as a second line across the full width). Keep a real `<table>` from
  `@3xl/list`. Explain a negative "Left over so far" ("Includes ₹3,20,000 put toward goals").
- **Goals:** cards in an auto-fill grid (`minmax(20rem,1fr)`: 1 to 4 columns); "Add money"
  inline, the rest in the menu; show the shared-account warning **once** above the grid, naming
  the account and the goals it affects, instead of on every card.

### Phase 5: Wealth

`feat(web): redesign the finance wealth views`

- B14. Convert Investments, Assets, and Net worth.
- **Investments:** keep the "Add" menu as the primary action. Holdings as compact `FinanceRow`s
  (name, kind chip, value, gain), grouped by account, with the figure grid (units, average cost,
  cost basis, price, realized) in `RowDetail`. From `@5xl/list`, holdings use aligned columns
  (a grid that reads like a table, with the same row markup). SIPs as chips on the row ("SIP
  ₹5,000 monthly · next 5 Nov"). Buy and Sell inline on wide rows, in the menu on narrow ones.
  Deposits the same way. Allocation and category bars side by side, then activity and accounts.
- **Assets:** a total tile; "Add asset" as the primary button; rows with "Update value" inline.
  A 2-column grid of rows at `@5xl/list`.
- **Net worth:** tiles, then the chart with a non-zero baseline and the change figures as its
  caption (one place for "how it changed"). Assets and liabilities breakdowns side by side.
  "What's counted" grouped by source (accounts, investments, deposits, other assets) as a
  collapsible `EndedSection`-style list, in two columns at `@5xl/list`. "Save this month's
  snapshot" moves to the view menu, unless no snapshot exists for this month; then it shows as a
  prompt.

### After the phases

- Update the memory note and this document's status.
- Check `docs/architecture.md` for anything describing the finance UI and update it if needed.

## 6. Screenshots and the preview setup

The "before" set in [`docs/finance-redesign/before/`](finance-redesign/before/) was made with
the tools in [`docs/finance-redesign/tools/`](finance-redesign/tools/). It never touches the dev
servers on ports 3000 and 8000.

```bash
# 1. A throwaway API on :8100 with a scratch SQLite database.
export SCRATCH=/path/to/a/scratch/dir
cd apps/api
ORBIT_SQLITE_PATH=$SCRATCH/orbit.sqlite3 uv run alembic upgrade head
ORBIT_SQLITE_PATH=$SCRATCH/orbit.sqlite3 ORBIT_API_PORT=8100 \
  ORBIT_CORS_ORIGINS='["http://localhost:3100","http://127.0.0.1:3100"]' uv run orbit-api &

# 2. Seed it (signs up preview@example.com; prints the session for localStorage).
python3 -I docs/finance-redesign/tools/seed.py > $SCRATCH/session.json

# 3. Build the web app against :8100 and serve it on :3100.
cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8100 pnpm build && pnpm exec next start -p 3100 &

# 4. Screenshot (headless Chrome over the DevTools protocol; Node 22+).
node docs/finance-redesign/tools/shoot.mjs $SCRATCH/session.json $SCRATCH/shots          # light
WIDTHS=1280 TABS=Overview,Investments node docs/finance-redesign/tools/shoot.mjs \
  $SCRATCH/session.json $SCRATCH/shots dark                                              # dark

# 5. Afterwards: stop both servers and run a plain `pnpm build`, so .next isn't left pointing
#    at :8100.
```

Seeded data: five INR accounts and a credit card, six months of salary and spending, an overall
budget and three category budgets, expected income, three savings goals, two loans (one with an
overdue EMI), four subscriptions and four bills (two overdue), three investment accounts with
five holdings, two SIPs, an FD and an RD, three other assets (one stale, one without a
valuation), and net-worth snapshots for five months. The seed is dated relative to today.

## 7. Open questions

1. **URL shape:** `?view=budgets` (smallest change; `FinanceView` stays one client component
   that owns the dialogs) or `/finance/budgets` route segments (cleaner URLs; more files, and
   dialogs would need lifting into a layout). This plan assumes `?view=`.
2. **Group names:** Money / Planning / Commitments / Wealth, as suggested. "Money" could be
   "Ledger"; "Commitments" could be "Bills and loans" if that reads friendlier.
3. **Categories:** keep them under Accounts (as now, in their own panel), or move them to
   Settings?
4. **Before screenshots in Git:** 42 WebP files, 3.4 MB. Commit them with this plan, or keep
   them local (and add `docs/finance-redesign/before/` to `.gitignore`), relying on the tools to
   regenerate them?

## 8. Outcome

All five phases were built on 2026-10-31. Decisions on the open questions:

1. **URL:** `?view=` (`lib/finance-views`), kept with the History API so Back works; no
   `useSearchParams`, which would need a Suspense boundary on the static page.
2. **Groups:** Money / Planning / Commitments / Wealth.
3. **Categories:** stay on Accounts, in their own panel with a narrow form.
4. **Screenshots:** kept out of Git (`docs/finance-redesign/before/` is ignored); the tools that
   make them are committed.

Where the build differs from the plan:

- **Rail breakpoint:** `@5xl/finance`, not `@4xl`. At `@4xl` a 1280 px laptop left the main column
  about 500 px wide; at `@5xl` laptops get the picker and the full width, and wider screens the rail.
- **Tiles:** `StatGrid` tracks are at least 13rem, and each tile is its own container that drops
  its icon and shrinks its figure when narrow, so four tiles fit at 1280 px.
- **Transactions:** days flow into two columns on very wide lists (like the task board) instead
  of one long column; the type filter is chips, the rest sit behind a Filters button below
  `@6xl/list`.
- **Upcoming:** the kind and status filters stay selects, because chips named "Subscriptions"
  and "Bills" would duplicate the navigation's buttons.
- **Net worth chart:** bars keep a zero baseline (a bar that doesn't start at zero misstates
  size); bars are capped in width instead, and the Change panel sits under the chart.
- **Not built as separate components:** `Meter`, `RowDetail`, and a shared `BarChart`. The
  existing `UtilizationBar`, `ProportionBars`, and per-row history toggles (now in each row's
  menu) cover the need; extract them if a third use appears.
- **Not done:** B15, moving `account-dialog.tsx` and `transaction-dialog.tsx` onto `DialogShell`.
  Their contents and behavior were out of scope for a layout change.
- Holdings keep their figure grid visible (compact, five columns on wide rows) rather than behind
  a disclosure; the actions shrank from six buttons to Buy plus a menu.
