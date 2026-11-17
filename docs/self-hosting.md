# Self-hosting Mailclaw (Docker)

Mailclaw can run as a single container on any host instead of Cloudflare
Workers. The same code serves both; the container provides its own database
(SQLite on a volume), blob storage (files on the same volume), job queue,
realtime WebSocket, backup schedule and an SMTP listener for inbound mail.

## Quick start

```bash
git clone https://github.com/your-org/mailclaw && cd mailclaw
cp .env.docker.example .env.docker      # edit: how to receive and send mail
docker compose up -d --build
```

Open `http://your-host:3000/setup`, create the admin account and add your
domain. All data lives in the `mailclaw-data` volume (`/data` in the
container): the SQLite database, raw messages, attachments and backups.

Sign-in works over plain `http://` too: the session cookie is marked
`Secure` only when the request arrived over HTTPS (directly, or through a
proxy that sends `X-Forwarded-Proto: https`). Use HTTPS for anything beyond a
trial on a private network; passkeys, push notifications and the PWA need it.

Behind a reverse proxy, set `APP_URL=https://mail.example.com` so links in
password-reset mail and the JMAP session point at the public address, and
forward WebSocket upgrades for `/api/realtime`. Passkeys also bind to this
origin, so they need `APP_URL` (or a direct HTTPS connection) to work.

Also set `TRUST_PROXY=1` behind a reverse proxy. Without it the server sees
every request coming from the proxy's address, so all users share one
sign-in rate limit and audit logs record the proxy instead of the client.
With it, the server takes the client address from the last entry of
`X-Forwarded-For`, the one your proxy appended, so the proxy must append
(not pass through) that header. Leave it unset when the container is exposed
directly: a client could then set the header itself and dodge the rate limit.
If another proxy or CDN sits in front of yours, have your proxy restore the
real client address first (nginx `real_ip`, Caddy `trusted_proxies`).

`TRUST_PROXY=1` also tells the server which address the browser used, from
`X-Forwarded-Proto` and `X-Forwarded-Host` (or `Host`). The server refuses
changes made with the session cookie (`POST`, `PUT`, `PATCH`, `DELETE` under
`/api/`) unless the browser's `Origin` matches that address, so behind an
HTTPS proxy without it every save fails with `403 Cross-site request
blocked`. Have the proxy send `X-Forwarded-Proto` and keep the original
`Host` (Caddy does both by default; in nginx add
`proxy_set_header Host $host;` and
`proxy_set_header X-Forwarded-Proto $scheme;`).

### PWA and push notifications

Mailclaw can be installed as a PWA and can deliver new-mail notifications
after the browser is closed. Generate one VAPID key pair for the installation:

```bash
npm run push:keys
```

Set the printed `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` values in the
runtime environment, plus `VAPID_SUBJECT` as either a `mailto:` contact or the
public HTTPS URL of the installation. Keep the private key secret. Browsers
require HTTPS for service workers and Web Push (localhost is the development
exception). Users can then enable push under **Settings → Inbox → Notifications**.

## Receiving mail

Pick one; both can be on at once.

**Built-in SMTP listener (default).** The container listens on port 25 and
accepts mail for every domain you add. Point the domain's MX record at the
host, set `MAIL_HOSTNAME` to that host's name, and make sure port 25 is
reachable from the internet (several clouds block it by default; Hetzner and
most VPS providers do not). The domain page in the app lists the MX, SPF and
DMARC records to create. Domain routing rules work as on Cloudflare: reject
rules answer the sender with a 550 during delivery, forward rules relay the
message through your outbound SMTP.

The listener decides each recipient when the sender names it (`RCPT TO`),
before any message data is sent:

- an address on a domain Mailclaw does not manage: `550 Relay access denied`;
- an unknown address on one of your domains: `550 No such user here`, so the
  sender gets a bounce instead of the mail vanishing;
- a sender blocked by a reject rule: `550` with the rule's reason, for that
  recipient only;
- the database cannot be reached: `451`, so the sender retries later.

After the message data, SMTP has a single answer for all recipients: `451`
if storing it failed for any of them (the sender retries), `550` if every
recipient was refused, otherwise `250`. When a sender retries after a `451`,
recipients that already received the message, and forwards already sent, are
not repeated. The server remembers that for 24 hours, in memory only: after
a restart a retry runs again, and while stored copies are still recognised
by their content, a forward rule can send a second copy.

Optional: `SMTP_TLS_KEY` and `SMTP_TLS_CERT` (paths inside the container)
enable STARTTLS with your own certificate. Without them STARTTLS is not
offered, which is safe but means transport encryption depends on the sender.

**Cloudflare Email Routing relay.** Keep MX on Cloudflare and deploy the
Worker in `deploy/cloudflare-email-relay`. It posts each message to
`/api/inbound` on your server, signed with `INBOUND_WEBHOOK_SECRET`, and acts
on the reject or forward decision the server returns. Set
`SMTP_INBOUND_PORT=0` if you do not want the listener at all.

## Sending mail

**Any SMTP relay.** `SMTP_URL=smtps://user:pass@host:465` (or `smtp://`
with STARTTLS). Works with your hosting provider's relay, Amazon SES,
Postmark, Mailgun, or a Postfix you run. Set
`SMTP_TLS_REJECT_UNAUTHORIZED=false` only for a relay with a self-signed
certificate on a private network.

**Cloudflare Email Sending.** `CF_ACCOUNT_ID` plus a `CF_TOKEN` with Email
Sending: Edit. The domain must be a Cloudflare zone with Email Sending set
up; Mailclaw calls the REST API, no Workers plan needed.

**Resend or Amazon SES, per domain.** Instead of one global relay, each domain
can send through Resend or SES with their APIs (no SMTP involved), and receive
through them too, once Mailclaw can manage the domain's DNS with `CF_TOKEN`.
Add the credentials on the domain page, or set `RESEND_API_KEY` /
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION`. Receiving
through either needs `APP_URL` set to your public HTTPS address. See
[Sending and receiving providers](providers.md). Using SES as a plain SMTP
relay through `SMTP_URL`, described above, still works and needs none of this.

## Cloudflare zone management (optional)

If `CF_TOKEN` can also edit DNS and Email Routing on your zones, adding a
domain configures Email Routing and the sending subdomain automatically,
exactly as on Workers. Without it, domains are recorded as manually managed
and the DNS page shows what to set by hand.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Address the HTTP server listens on; `127.0.0.1` keeps it reachable only through a proxy on the same host |
| `TRUST_PROXY` | unset | `1` (or `true`, `yes`) behind a reverse proxy: trust the client address it appends to `X-Forwarded-For`. See [Quick start](#quick-start) |
| `DATA_DIR` | `/data` | SQLite database, blobs and backups |
| `DATABASE_URL` | unset | Use PostgreSQL, MySQL or libSQL instead of the SQLite file in `DATA_DIR`; see [Databases](databases.md). Migrations are applied on start. |
| `DATABASE_DRIVER` | inferred | Only to override the driver inferred from `DATABASE_URL` |
| `APP_URL` | request origin | Public URL behind a proxy |
| `SMTP_INBOUND_PORT` | `25` | Inbound SMTP; `0` disables |
| `SMTP_INBOUND_HOST` | all addresses | Address the SMTP listener binds to |
| `MAIL_HOSTNAME` | `mail.<domain>` | Host the MX record points at; SMTP banner |
| `SMTP_MAX_SIZE` | 36 MiB | Largest raw inbound message; allows for encoding overhead on up to 25 MB of attachments. Oversized mail receives an SMTP rejection, which the sender's mail provider can report as a delivery failure. |
| `SMTP_TLS_KEY`, `SMTP_TLS_CERT` | unset | STARTTLS certificate for the listener |
| `SMTP_URL` | unset | Outbound relay |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | `true` | Trust self-signed relay certificates when `false` |
| `CF_ACCOUNT_ID`, `CF_TOKEN` | unset | Cloudflare Email Sending, and zone management if the token allows |
| `CF_EMAIL_WORKER_NAME` | `mailclaw` | Worker the Email Routing rules created by zone management deliver to; set it to `mailclaw-email-relay` (or your relay Worker's name) when receiving through the relay |
| `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT` | unset | Store blobs in Backblaze B2 (all four required) instead of files under `/data/blobs`; see [Deployment](deployment.md#object-storage-r2-backblaze-b2-or-aws-s3) |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | Store blobs in AWS S3; the keys fall back to `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Backblaze wins if both are set |
| `RESEND_API_KEY` | unset | Resend key, used when none is saved in the app |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | unset | Amazon SES credentials, used when none are saved in the app |
| `INBOUND_WEBHOOK_SECRET` | unset | Enables `/api/inbound` for the relay Worker |
| `INBOUND_REQUIRE_SIGNED_HEADERS` | unset | Set to `1` once the relay Worker is updated: refuses relays that do not sign the header map with a timestamp (older relays stay accepted without it, and their requests can be replayed) |
| `TURNSTILE_SECRET_KEY` | unset | Bot protection on login and reset forms (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` at build time) |
| `VAPID_PUBLIC_KEY` | unset | Public Web Push application-server key |
| `VAPID_PRIVATE_KEY` | unset | Secret Web Push application-server key |
| `VAPID_SUBJECT` | unset | Web Push contact URI (`mailto:` or HTTPS) |
| `AI_BASE_URL` | unset | OpenAI-compatible model API base URL for the assistant |
| `AI_API_KEY` | unset | Server-only key for that model API |
| `AI_MODEL` | `gpt-4o-mini` | Model ID supported by the configured API |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | unset | Native push to the iOS app straight through Apple: key ID, team ID and the contents of the `.p8` key |
| `APNS_RELAY_URL` | unset | Native push through a Mailclaw push relay (`https://` origin) instead of your own Apple key |
| `SPAMHAUS_DQS_KEY` | unset | Spamhaus DQS key: ZEN (sending IP) and DBL (domain) checks on incoming mail. Can also be set under **Admin → Spam filter** |
| `ABUSECH_AUTH_KEY` | unset | abuse.ch Auth-Key: URLhaus checks on links in incoming mail. Can also be set under **Admin → Spam filter** |
| `SPAM_DOMAIN_AGE_CHECK` | on | `off` disables the domain-age lookups to rdap.org |
| `SQLITE_CACHE_KB` | SQLite default | Page cache size in KiB, for large databases |
| `SQLITE_MMAP_BYTES` | `0` | Memory-mapped I/O window in bytes; reads are then served from the OS page cache |
| `SQLITE_TEMP_STORE` | file | `memory` keeps temporary sort tables in memory |
| `SQLITE_SYNCHRONOUS` | `FULL` | `NORMAL` writes faster; safe from corruption under WAL, but a power loss can roll back the last transactions |
| `MIGRATIONS_DIR` | `./drizzle/migrations` | Where the SQLite migrations applied at start are read from |
| `PUBLIC_DIR` | `./public` | Static files served by the app |

The `SQLITE_*` variables apply only to the built-in SQLite file. The defaults
suit small installs; raise the cache and mmap window when the database grows
to several gigabytes.

The server passes a fixed list of variables from its environment to the app:
the ones in this table, plus the legacy `CF_EMAIL` / `CF_API_KEY` pair.
Anything else from the Workers list in
[Deployment](deployment.md#worker-variables-and-secrets) has no effect on a
self-hosted install.

Calls to outside services (Cloudflare, AWS, Resend, push services) give up
after a fixed time instead of hanging: 30 seconds for API calls, 60 for
sending a message, 120 for moving a whole raw message to or from storage and
10 for a push notification.

## Operations

- **Backups.** The daily 02:00 UTC backup and the admin Backups page work
  unchanged; files land under `/data/blobs/backups`. Back up the whole volume
  for a full copy.
- **Updates.** Pull the new image and recreate the container; migrations run
  at start. The in-app update button is disabled on self-hosted installs.
- **Logs.** `docker compose logs -f mailclaw`.
- **Queues.** Jobs are held in memory and run a few at a time (2 inbound, 4
  outbound, 2 assistant), the rest waiting their turn. A failed job is retried
  like on Workers: 5 times for mail (3 for the assistant), waiting 10 s, 30 s,
  90 s and so on up to 15 minutes. There is no dead-letter queue; a job that
  runs out of retries is logged (`giving up after`) and dropped.
- **Restarts.** Inbound mail is written to the volume before it is queued,
  so a restart never loses a message. On start the server re-queues raw
  messages from the last 24 hours that no stored message refers to (up to
  1,000 per start), and re-queues scheduled and undo-window sends whose
  timers died with the previous process.

## Email assistant and MCP

Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in the container environment to configure the built-in assistant. These values stay on the server. Assistant chat is available by default when a provider is configured; a mailbox manager can change its writing instructions and availability through the settings button in the assistant panel. Automatic reply drafts remain off until enabled there. Auto-draft work is recorded in SQLite and retried after a restart by the local scheduler. AI failure does not reject inbound mail. Out-of-office auto-replies and AI auto-drafts are separate features; turn off out-of-office replies before enabling auto-drafts for a mailbox.

The MCP endpoint is `/mcp`. Create a dedicated mailbox-scoped Bearer key in **Assistant → MCP** and give the key to a client that supports custom HTTP headers. The endpoint uses Streamable HTTP; `request_send` gives the client a review URL, and only an authenticated Mailclaw browser session can confirm delivery. MCP read and draft tools remain available when no AI model is configured.

## Running without Docker

```bash
npm ci
npm run build:node
MAILCLAW_RUNTIME=node NODE_ENV=production DATA_DIR=./data node dist/server.mjs
```

`npm run start:node` runs the same server and sets `MAILCLAW_RUNTIME` and
`NODE_ENV` itself, so it also works from a Windows shell; `DATA_DIR`
defaults to `./data`.

Port 25 needs root or a capability (`setcap cap_net_bind_service=+ep`); use
`SMTP_INBOUND_PORT=2525` behind a port forward otherwise.
