# Backing up, restoring, and exporting your data

Everything here is in **Settings → Backup & restore**, and applies to the workspace you have
open. Each workspace is backed up on its own.

## What a backup contains

- Every record in the workspace: tasks, shopping lists, reminders and notifications, finance
  (accounts, transactions, commitments, investments, budgets, goals, plans), notes, the
  calendar, habits and routines, documents, your health and fitness records, assistant
  conversations, and saved searches. Links between records are kept.
- Optionally, the workspace's files: documents and their versions, note attachments, and
  progress photos.
- A manifest listing every part with its size and SHA-256 checksum, the Orbit version, and the
  database schema version it was made with.

A backup never contains passwords, sign-in sessions, AI provider keys, or connected accounts'
tokens. After restoring, reconnect integrations and AI providers if you use them. Per-person
preferences (dashboard layout, calendar view settings) aren't part of a workspace backup.
Neither is Automation: the agent's settings, workflows, memory, run history, and approvals are
left out on purpose, so a restore never starts automations, replays approvals, or resumes runs.
Set up the agent and its workflows again after restoring.

## Creating a backup

1. Choose **Create backup**.
2. Decide whether to **include files**. Without them the backup is smaller, but restored
   documents, attachments, and photos show their files as missing.
3. Choose the **encryption**:
   - **Not encrypted**: anyone holding the file can read it.
   - **A password for this backup**: at least 10 characters. Orbit never stores it; if you lose
     it, the backup can't be opened.
   - **Backup password**: the password from the automatic backup settings (below).

Backups are kept where the Orbit API runs: on your computer in local mode, on the server
otherwise. A copy on the same disk doesn't protect you from losing that disk, so **download**
backups now and then and keep them somewhere else. **Check integrity** compares a stored backup
with its checksums (for an encrypted backup, with its password, every part is checked).

You can also download a backup without keeping it on the server: **Export → Workspace with
files (.zip)**.

## Automatic backups

Under **Automatic backups**, choose daily, weekly, or monthly backups, how many to keep (older
automatic backups are deleted; manual ones stay until you delete them), and whether to include
files. The first one runs within a minute of turning them on. If the server was off when one was
due, it runs once when the server starts again. Every run appears in the history, including
failed ones, which are retried an hour later.

To encrypt automatic backups, set a **backup password**. Orbit keeps a key that can lock backups
but not open them; the password is needed only to restore. Changing the password affects new
backups; older ones keep the password they were made with.

## Restoring a backup

1. Under **Restore and import**, choose the backup file (`.zip` or `.orbit-backup`). It's
   uploaded and kept for 24 hours; nothing changes yet.
2. Enter the password if it's encrypted.
3. Orbit checks the archive's structure and every checksum, confirms this version of Orbit can
   read it, and does a dry run. You see where it came from, what it holds, and any warnings.
4. Choose where to restore it:
   - **As a new workspace**: nothing existing changes. If the original workspace still exists,
     the copy's records get new IDs so the two never share a record.
   - **Into this workspace**: only when this workspace has no records yet.
   - **Replace this workspace's data**: type the workspace's name to confirm. Orbit first makes a
     **Before restore** backup of the current data, so you can go back. Disconnect the
     workspace's integrations first.
5. Confirm. The restore either completes entirely or changes nothing, and the result says what
   was restored.

A backup made by a newer version of Orbit can't be restored; update Orbit first. Backups from
earlier versions are checked record by record.

## Exporting a module

Under **Export**, each module can be downloaded as JSON, and in everyday formats where they
fit: CSV for tasks, shopping lists, reminders, habits, and health records; an iCalendar `.ics`
file for the calendar (open it in any calendar app, recurring events and their changes
included); and Markdown files for notes, in their folders with their tags. Finance's
transaction spreadsheet and the document vault's original files have their own **Export**
buttons in Finance and Documents.

Amounts in exports are exact: integer amounts in the currency's smallest unit (paise, cents)
with the currency beside them.

## Importing an export

Choose a JSON export under **Restore and import**. Orbit shows what it would add before
anything changes. Records already in this workspace are left alone, so importing the same file
twice adds nothing the second time; categories and tags with the same name as existing ones are
reused; records that would conflict (a second journal entry for the same day) or that refer to
records missing from both the file and the workspace are left out and counted. JSON exports
don't contain files.

## Keeping backups safe

Backups contain all of a workspace's data, including document numbers and health records.
Unencrypted backups are only as safe as wherever you keep them. Encrypted backups use
Argon2id and AES-256-GCM; they protect the file, not the running Orbit installation, whose data
relies on your disk's encryption (FileVault, BitLocker, LUKS).
