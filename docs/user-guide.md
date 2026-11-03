# Using Orbit

A short guide for people using Orbit day to day. For installing it, see the
[README](../README.md#getting-started) or [deployment.md](deployment.md). Orbit keeps your data
on the server you run it on; nothing is sent elsewhere unless you connect an AI provider or a
Google or Microsoft account.

## Getting started

1. Open Orbit (for example <http://localhost:3000>) and choose **Create account**. On a new
   installation the first account owns it. Other people can register only if the installation
   allows it (`ORBIT_LOCAL_OPEN_REGISTRATION`).
2. You start in your **Personal** workspace. Everything you create belongs to a workspace, and
   only you can see your workspaces.
3. Press **Cmd/Ctrl+K** for the command palette: search, jump to a page, or start an action.
   **Cmd/Ctrl+B** collapses the sidebar.

Each device signs in separately and works directly with the server, so changes made on one device
appear on the others when they reload. There is no offline mode.

## Account and workspaces

- **Settings → Account:** your name, profile photo, time zone, and, for local accounts, **Change
  password**. Changing it signs out your other devices. After repeated wrong passwords, sign-in
  pauses for up to 15 minutes.
- Local accounts have no "forgot password" recovery. Keep your password in a password manager.
  Cloud (Supabase) accounts can reset it by email.
- **Settings → Workspaces:** create, rename, switch, and delete workspaces. Deleting a workspace
  permanently removes everything in it, including its files and stored backups. The Personal
  workspace can't be deleted, and accounts can't yet be deleted from the app.

## Everyday modules

- **Dashboard:** today at a glance, with tasks, events, habits, reminders, and money. Choose and
  arrange its widgets; amounts can be hidden.
- **Tasks:** add with **N**, set due dates and priorities, and complete with the checkbox. Tasks
  can be scheduled into calendar time blocks.
- **Reminders:** one-time or recurring (daily, chosen weekdays, monthly), optionally about a
  task. They arrive as in-app notifications (the bell) while Orbit's worker runs. There are no
  email or push notifications.
- **Shopping:** lists and items, checked off as you go.
- **Calendar:** month, week, day, and agenda views. Events can repeat; edit one occurrence or
  "this and following". Drag to reschedule. Export as `.ics`.
- **Habits:** yes-or-no, amount, or duration habits on a schedule, logged once a day (partial
  progress and skips count). Routines are ordered steps you run as a session. Streaks and rates
  are computed from your history.
- **Health:** workouts from templates with sets and personal records, body measurements,
  progress photos, nutrition, water, activity, and goals. Health records are private to the
  person who records them.
- **Finance:** accounts, income, expenses, refunds, and transfers, which you enter yourself.
  Orbit doesn't connect to banks. Paying a credit card bill or moving money into an investment
  is a transfer, not spending. Also:
  - loans with EMI schedules, subscriptions, and bills;
  - investments and other assets, and net worth;
  - budgets with alerts, savings goals, and a monthly plan;
  - CSV export.
- **Notes:** a rich-text editor that saves as you type. If the same note is changed on another
  device, Orbit tells you instead of overwriting it. Notes have folders, tags, an Inbox, quick
  capture (the sidebar's **Quick note**), links between notes, a daily journal, attachments,
  archive and trash, and Markdown import and export.
- **Documents:** a vault for files and records such as IDs and policies. It has categories, tags,
  metadata, expiry, renewal, and review dates (with a reminder), previews, version history, and
  ZIP export. Files aren't encrypted by Orbit; use an encrypted disk.
- **Search:** `/search` or the command palette searches every module. Recent and saved searches
  are kept per person.

## Backup and restore

**Settings → Backup & restore.**

- A backup is an archive of the workspace's records and files, checked with checksums. With a backup password
  it is encrypted; without the password it can't be restored, and Orbit can't recover it.
- Automatic backups run daily, weekly, or monthly and keep the number you choose.
- **Restore** inspects an uploaded backup first and shows what it would do. You can restore into
  a new workspace, into an empty one, or replace the current one; replacing first makes a backup
  of what is there now.
- Module exports (JSON, CSV, iCalendar, Markdown) take data elsewhere. JSON exports can be
  imported back, and duplicates are detected.
- Keep copies of important backups outside the Orbit server too. Backups live on the same
  machine as the data.

## AI and the assistant

**Settings → AI.** AI is off until you turn it on, and it is per person.

- Choose a provider: a local model (Ollama, or an OpenAI-compatible server on your network), or
  a cloud provider (OpenAI, Anthropic, Gemini) with your own API key. Keys are stored encrypted
  on the server. A cloud provider receives the parts of your data needed to answer, so Orbit
  asks for your consent first.
- Choose which modules AI may read. Health and finance can stay off.
- **Assistant:** ask questions. Answers cite the records they used, and numbers come from Orbit's
  own calculations rather than the model. Anything that would change data is shown as a proposal
  that you approve or dismiss.

## Automation

**Automation** is off until you turn it on, per person and workspace.

- Choose what the agent may do: read only, suggest, ask for approval, or (limited) do low-risk
  actions you allowed on its own, within a daily quota. It can't delete, pay, send email, share,
  or change settings. Finance, mail, habits, and health are read only to it.
- Workflows run on a schedule, when something happens, when a condition becomes true, or when
  you start them. Approvals appear in one place and expire if unused.
- Every run is recorded with its steps. What the agent remembers about your preferences can be
  reviewed, edited, and deleted.

## Integrations

**Settings → Integrations.** Available when the installation's administrator has set up Google
or Microsoft OAuth (see [integrations.md](integrations.md)).

- Calendars are imported into Orbit's calendar and kept up to date. Two-way sync of single events is optional.
  When both sides change an event, Orbit records a conflict for you instead of overwriting.
- Mail is read only when you ask, from labels you choose, to turn messages into tasks, notes,
  or reminders. Orbit never sends email.
- Files from Google Drive or OneDrive are imported one at a time into Documents.
- Disconnecting revokes Orbit's access and deletes its tokens, and can also remove what was
  imported.

## Storage

**Settings → Storage** shows where your data lives: a SQLite database on the server (local mode)
or a PostgreSQL database (cloud mode). The two modes don't sync with each other.

## Not available

Orbit has no voice interface, no offline multi-device sync, no shared workspaces or
invitations, no OCR, no bank or live-price connections, and no email or push notifications.
