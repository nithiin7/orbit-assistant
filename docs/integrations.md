# Integrations

Orbit can connect Google and Microsoft accounts: calendars come into Orbit's calendar, email
can be turned into tasks, notes, and reminders, and cloud files can be imported into
Documents. This guide is for whoever runs an Orbit server. It covers creating the OAuth apps,
configuration, the permissions Orbit asks for, push notifications, and known limitations. The
design is in [architecture.md](architecture.md#external-integrations).

Each Orbit installation uses **its own** OAuth apps. Orbit has no central service: your
server talks to Google and Microsoft directly, and tokens never leave it.

## What people can do

| Provider  | Calendar                                                       | Mail                                                | Files                                |
| --------- | -------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Google    | Google Calendar: import chosen calendars; optionally two-way   | Gmail: read chosen labels; create linked records    | Google Drive: browse, search, import |
| Microsoft | Outlook calendars: import chosen calendars; optionally two-way | Outlook: read chosen folders; create linked records | OneDrive: browse, search, import     |

Nothing is synchronized until a person selects it, and mail is never copied into Orbit or
sent. Several accounts per provider can be connected; each belongs to one person and one
workspace.

## Permissions (scopes)

Orbit asks only for what the person ticks when connecting, and records what was actually
granted (people can untick permissions on the provider's consent screen).

| Capability      | Google                                                       | Microsoft Graph                         |
| --------------- | ------------------------------------------------------------ | --------------------------------------- |
| Always          | `openid`, `email` (who the account is)                       | `openid`, `offline_access`, `User.Read` |
| Calendar (read) | `calendar.calendarlist.readonly`, `calendar.events.readonly` | `Calendars.Read`                        |
| Calendar (edit) | `calendar.events` (events only, not calendars or sharing)    | `Calendars.ReadWrite`                   |
| Mail (read)     | `gmail.readonly`                                             | `Mail.Read`                             |
| Files (read)    | `drive.readonly`                                             | `Files.Read`                            |

Why these: listing calendars and reading events needs the two read-only calendar scopes;
`calendar.events` lets Orbit send edits back only when a person turns on two-way sync. Gmail's
search needs `gmail.readonly` (the metadata scope can't search). Browsing Drive folders needs
`drive.readonly`; `drive.file` would only see files Orbit created. Orbit never requests send,
delete, or modify permissions for mail or files.

Google classifies `gmail.readonly` and `drive.readonly` as **restricted** scopes: an app in
production with them needs Google's verification (and a security assessment for restricted
scopes). For personal use, keep the Google app in **Testing** and add yourself as a test user;
tokens for apps in testing expire after seven days, after which Orbit asks you to reconnect.

## Google setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library:** enable the Google Calendar API, Gmail API, and Google Drive
   API (only those you'll use).
3. **OAuth consent screen:** user type External (or Internal for a Workspace organization),
   add the scopes above that you want to offer, and add yourself under **Test users**.
4. **Credentials → Create credentials → OAuth client ID:** application type **Web
   application**. Under **Authorized redirect URIs**, add Orbit's callback exactly, for example
   `http://localhost:3000/integrations/callback` locally or
   `https://orbit.example.com/integrations/callback` when hosted.
5. Set on the API (`apps/api/.env`):

   ```bash
   ORBIT_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   ORBIT_GOOGLE_CLIENT_SECRET=GOCSPX-…
   ORBIT_INTEGRATIONS_REDIRECT_URL=http://localhost:3000/integrations/callback
   ```

Orbit uses the Authorization Code flow with PKCE, asks for offline access (a refresh token),
and revokes the token at Google when someone disconnects.

## Microsoft setup

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/), go to **App
   registrations → New registration**.
2. **Supported account types:** choose who may connect. "Accounts in any organizational
   directory and personal Microsoft accounts" matches `ORBIT_MICROSOFT_TENANT=common`.
3. **Redirect URI:** platform **Web**, value Orbit's callback exactly (as for Google).
4. **Certificates & secrets → New client secret**, and copy its value. (Alternatively register
   the redirect under **Mobile and desktop applications** and use no secret; PKCE still
   protects the code.)
5. **API permissions → Microsoft Graph → Delegated:** add `User.Read`, `offline_access`, and
   whichever of `Calendars.Read`, `Calendars.ReadWrite`, `Mail.Read`, and `Files.Read` you'll
   offer.
6. Set on the API:

   ```bash
   ORBIT_MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
   ORBIT_MICROSOFT_CLIENT_SECRET=…
   ORBIT_MICROSOFT_TENANT=common
   ```

Microsoft has no endpoint for an app to revoke its own grant. When someone disconnects, Orbit
deletes its tokens and tells them to remove Orbit at
[account.live.com/consent/Manage](https://account.live.com/consent/Manage) (personal accounts)
or [myapps.microsoft.com](https://myapps.microsoft.com) (work or school).

## Token storage

- Access and refresh tokens are encrypted with Fernet before they're stored, using
  `ORBIT_INTEGRATIONS_SECRET_KEY`, or in local mode an `integrations-secret.key` file (mode
  `0600`) created beside the database. This key is separate from the AI key.
- **Cloud mode requires `ORBIT_INTEGRATIONS_SECRET_KEY`.** Without it, Orbit refuses to connect
  accounts rather than store tokens it can't protect. Generate one with
  `uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  and keep it in your secret manager, not in the database's environment backups.
- Tokens are never returned by the API, logged, or sent to the browser; the browser holds only
  Orbit's own session. Changing the key makes stored tokens unreadable: people reconnect, and
  their imported data is kept.
- Backups: see [development.md](development.md#backups). Leave the key out of database backups.

## Push notifications (optional)

Without further setup, Orbit polls each selected calendar on the interval chosen for it (15
minutes to daily, or only when asked). For near-real-time updates when the API is reachable
on the internet:

```bash
ORBIT_INTEGRATIONS_WEBHOOK_URL=https://orbit.example.com/api/v1/integrations/webhooks
```

Orbit then registers a Google Calendar watch channel or a Microsoft Graph subscription per
selected calendar after each synchronization, and renews it before it expires. Each channel
gets its own random secret (Google's channel token, Graph's `clientState`), stored only as a
SHA-256. A notification is accepted only if its secret matches, and it only queues a
synchronization: Orbit never trusts the payload's content. Graph's validation requests are
answered by echoing the token as plain text. The URL must be `https`.

## Local deployment

- Google and Microsoft both allow `http://localhost` redirect URIs, so a local Orbit works
  without HTTPS. In production, the redirect must be `https` (loopback excepted).
- Push notifications can't reach a machine behind NAT; local installs poll.
- Tokens are as safe as the machine: use full-disk encryption.

## Known limitations

- **Recurring events.** Google series whose rule Orbit can represent (daily; weekly on days that
  include the first; monthly on the start's day; yearly; with an interval, count, or end date)
  become Orbit series with their changed and cancelled occurrences. Other rules ("second Tuesday
  of the month") are imported as separate events, a month back to a year ahead. Microsoft
  calendars are always imported as separate occurrences in a rolling window (a month back to a
  year ahead, moved monthly), because Graph's change tracking works on expanded calendar views.
- **Two-way sync** sends Orbit edits of single events (and Outlook occurrences) back with the
  provider's version check; edits of repeating series stay in Orbit and are labeled. Deleting
  an event in Orbit never deletes it at the provider. "Add to calendar" sends single events.
- **Time zones.** Google events keep their IANA zone. Outlook reports Windows zone names; common
  ones are mapped, others fall back to UTC (the instant is still right).
- **Attendees, invitations, reminders, and free/busy** aren't imported.
- **Mail** is listed from the selected labels or folders (not their subfolders) within the
  chosen period, read when opened, and shown as plain text. The list shows the 20 most recent
  matches; search to narrow it. Attachments aren't shown.
- **Files** are imported one at a time, within Documents' size limit. Google Docs, Sheets, and
  Slides are exported as PDF; other Google-native types can't be imported. A Drive file's
  version can change on metadata edits (such as a rename), which shows as an update.
- **Conflicts** are detected for events. An event changed in Orbit and at the provider is kept
  as it is in Orbit until the person chooses a version in Settings → Integrations.
