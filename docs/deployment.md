# Deployment guide

Orbit ships as two container images, one per app, and a Docker Compose file that runs them
together. This guide covers self-hosting with Compose, running behind HTTPS, the published
images, backups, and upgrades. For local development without containers, see
[development.md](development.md).

## What runs

| Service   | Image                               | Role                                                                                    |
| --------- | ----------------------------------- | --------------------------------------------------------------------------------------- |
| `migrate` | `orbit-api` (`apps/api/Dockerfile`) | Applies database migrations, then exits. The API waits for it.                          |
| `api`     | `orbit-api`                         | FastAPI on port 8000, with the reminder and AI indexing worker inside the same process. |
| `web`     | `orbit-web` (`apps/web/Dockerfile`) | Next.js standalone server on port 3000.                                                 |
| `proxy`   | `caddy:2` (optional profile)        | HTTPS on your domain: `/api/*` to the API, everything else to the web app.              |

Both images run as unprivileged users, are built from the repository root (the build context
needs the pnpm and uv workspaces and their lock files), and declare health checks. The API image
defaults to `ORBIT_ENV=production`, so interactive API docs are off, CORS origins must be
explicit, and in local mode only the first account can register.

## Quick start (one machine)

Requirements: Docker with the Compose plugin (v2.24 or newer).

```bash
git clone https://github.com/nithiin7/orbit-assistant.git
cd orbit-assistant
cp .env.example .env        # optional; the defaults work on localhost
docker compose up -d --build
```

Open <http://localhost:3000> and create your account. The first account owns the installation.
By default, ports are published on `127.0.0.1` only, so Orbit is reachable from this machine and
nowhere else.

```bash
docker compose ps                  # status and health
docker compose logs -f api         # follow API logs
docker compose down                # stop (data is kept in the orbit-data volume)
```

## Configuration

Compose reads `.env` beside `compose.yaml` ([`.env.example`](../.env.example) documents every
value). It serves two purposes:

- **Addresses and ports** (`PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `BIND_ADDRESS`, `WEB_PORT`,
  `API_PORT`, `DOMAIN`), interpolated into `compose.yaml`.
- **API settings**: any `ORBIT_*` variable from
  [`apps/api/.env.example`](../apps/api/.env.example) is passed to the API and the migration
  step. `ORBIT_CORS_ORIGINS` is derived from `PUBLIC_WEB_URL`.

`PUBLIC_API_URL` becomes the web app's `NEXT_PUBLIC_API_URL`, which Next.js inlines into the
browser bundle **at build time**. After changing it, rebuild with
`docker compose up -d --build`. It is public; never put secrets in it.

## HTTPS on your own domain

On a server with a public IP, point a DNS record at it, open ports 80 and 443, and set:

```dotenv
DOMAIN=orbit.example.com
PUBLIC_WEB_URL=https://orbit.example.com
PUBLIC_API_URL=https://orbit.example.com
```

Then start with the proxy profile:

```bash
docker compose --profile proxy up -d --build
```

[Caddy](https://caddyserver.com/) obtains and renews certificates automatically
([`deploy/Caddyfile`](../deploy/Caddyfile)) and adds security headers. Web and API share one
origin, and the API's own ports stay bound to `127.0.0.1`. Keep `BIND_ADDRESS=127.0.0.1` so the
only public entry point is the proxy.

If you already run a reverse proxy, skip the profile and route `/api/*` to port 8000 and
everything else to port 3000 the same way. Don't buffer `text/event-stream` responses; the
assistant streams its answers.

Behind any proxy, set `ORBIT_FORWARDED_ALLOW_IPS` in `.env` to the proxy's address (or `*` when
the API is reachable only through the proxy and `127.0.0.1`). Sign-in limits count attempts per
client address; without it, every visitor appears to be the proxy and shares one limit. A
proxy's `X-Request-ID` header is kept, so its logs and the API's can be matched.

## Monitoring and logs

| Endpoint                      | Meaning                                                                                                              | Use for                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `GET /api/v1/health/live`     | The API process answers (also `GET /api/v1/health`).                                                                 | Liveness, restarts        |
| `GET /api/v1/health/ready`    | The database answers and its schema matches this version (503 with `database: unavailable` or `outdated` otherwise). | Readiness, load balancers |
| `GET /api/v1/health/database` | The database answers a query; reports the storage mode.                                                              | Diagnostics               |

None needs a session or reveals paths, versions of dependencies, or connection details. The API
image's Docker health check uses `/health/ready`, so Compose starts the web app only once the
database is migrated and reachable.

Every API response carries an `X-Request-ID` header, and every API log line includes it, so a
failure someone reports can be found in `docker compose logs api`. Logs record each request's
method, path, status, and duration, never query strings (they hold search terms) or bodies.
Successful health probes aren't logged. Set `ORBIT_LOG_FORMAT=json` for one JSON object per line.
Worker activity (reminders, indexing, integration sync, backups, agent runs) is logged by the
same process; `docker compose exec api orbit-worker status` counts reminder deliveries by status.

## Integrations

To offer Google or Microsoft accounts, create OAuth apps as in [integrations.md](integrations.md)
and set their client IDs and secrets in `.env`. Register the redirect URI as
`${PUBLIC_WEB_URL}/integrations/callback` and set `ORBIT_INTEGRATIONS_REDIRECT_URL` to the same
value. In cloud mode also set `ORBIT_INTEGRATIONS_SECRET_KEY`; without it, accounts can't be
connected. With the HTTPS proxy, setting
`ORBIT_INTEGRATIONS_WEBHOOK_URL=https://orbit.example.com/api/v1/integrations/webhooks` lets
calendars update as they change instead of on a schedule.

## Storage modes

**Local mode (default).** SQLite, note attachments, document files, and the generated AI key
file all live in the `orbit-data` volume at `/data`. One API container serves everyone: SQLite
and the file store are on that container's disk, so don't scale the `api` service beyond one
replica.

**Cloud mode.** Set `ORBIT_STORAGE_MODE=cloud`, `ORBIT_DATABASE_URL` (with `?ssl=require`),
`ORBIT_SUPABASE_URL`, and `ORBIT_SUPABASE_PUBLISHABLE_KEY` in `.env`, and set
`ORBIT_AI_SECRET_KEY` if people will store AI provider keys. The `migrate` service then
**migrates the Supabase database** on every `docker compose up`. Attachment and document files
still live in the `orbit-data` volume (object storage isn't implemented), so the same
single-replica limit applies to file features.

## Using the published images

The [Containers workflow](../.github/workflows/containers.yml) publishes multi-architecture
(amd64 and arm64) images to the GitHub Container Registry on pushes to `main` and on `v*` tags:

- `ghcr.io/<owner>/orbit-api`: `main`, `sha-<short>`, and for releases `X.Y.Z`, `X.Y`, `latest`.
- `ghcr.io/<owner>/orbit-web`: the same tags.

Packages are private by default on GitHub; make them public in the package settings to share
them. To run without building:

```dotenv
ORBIT_API_IMAGE=ghcr.io/<owner>/orbit-api:latest
ORBIT_WEB_IMAGE=ghcr.io/<owner>/orbit-web:latest
```

```bash
docker compose pull && docker compose up -d --no-build
```

The API image is configured entirely at runtime. The published **web** image is built for
`http://localhost:8000`, so it suits a single machine. For any other API address, build the web
image yourself (`docker compose build web` with `PUBLIC_API_URL` set).

Running a single image directly:

```bash
docker volume create orbit-data
docker run --rm -v orbit-data:/data ghcr.io/<owner>/orbit-api migrate
docker run -d --name orbit-api -p 127.0.0.1:8000:8000 -v orbit-data:/data \
  -e ORBIT_CORS_ORIGINS='["http://localhost:3000"]' ghcr.io/<owner>/orbit-api
```

The API image's commands are `api` (default), `migrate`, and `worker [args]`, for example
`docker compose exec api orbit-worker status` or
`docker compose run --rm api worker retry-failed`.

## Backups and restore

Everything Orbit stores in local mode is in the `orbit-data` volume. Back it up while the stack
is stopped, so the SQLite database and files are consistent:

```bash
docker compose stop api
docker run --rm -v orbit_orbit-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/orbit-backup-$(date +%F).tar.gz --exclude=./integrations-secret.key -C /data .
docker compose start api
```

Restore into an empty volume with
`tar xzf orbit-backup-<date>.tar.gz -C /data` in the same kind of throwaway container. The
backup contains your personal data and `ai-secret.key`; store it encrypted. It leaves out
`integrations-secret.key`, so the connected accounts' tokens in the backup can't be used by
anyone holding it; after restoring onto a new volume, people reconnect their accounts (imported
data is kept). In cloud mode, back
up the database with Supabase and the volume as above.

Workspace backups made in **Settings → Backup & restore** are
stored in the same volume (`backups/`, or `ORBIT_BACKUPS_PATH`), so a copy of the volume includes
them; download important ones to keep a copy off the server. They're also the way to move a
workspace between installations, including from local to cloud mode.

## Upgrading

```bash
git pull
docker compose up -d --build     # or: docker compose pull && docker compose up -d --no-build
```

The `migrate` service applies new migrations before the API starts. Back up first: migrations
are not reversed automatically. If the API is started against a database that hasn't been
migrated, it refuses to start and says which revision it expects; `/health/ready` reports
`outdated` if the schema changes underneath a running API.

## Security checklist

- Keep `.env` out of version control (it is git-ignored) and readable only by you.
- Expose Orbit to the internet only through HTTPS (the `proxy` profile or your own proxy).
- Leave `ORBIT_LOCAL_OPEN_REGISTRATION` unset unless you mean to let anyone who can reach the
  server create an account.
- Behind a proxy, set `ORBIT_FORWARDED_ALLOW_IPS` (see above) so sign-in limits work per client.
- Orbit doesn't encrypt files at rest; use an encrypted disk for the Docker data directory.
- OAuth client secrets and `ORBIT_INTEGRATIONS_SECRET_KEY` are server-only: never put them in
  `PUBLIC_*` values, which reach browsers.
- In cloud mode, `ORBIT_AI_ALLOW_PRIVATE_ENDPOINTS` stays off by default so AI provider URLs
  can't reach the server's internal network.
