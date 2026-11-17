# Deployment and configuration

This guide covers Cloudflare deployment, runtime configuration, database backups, and application updates.

## Overview

Set up Mailclaw in three steps:

1. **Deploy the app:** use the Deploy to Cloudflare button, set the app name to `mailclaw`, and provide the required `CF_TOKEN`.
2. **Complete setup:** open the deployed app and follow `/setup` to check the installation and create the first admin account.
3. **Connect your domain:** add a domain managed by the same Cloudflare account and choose which service receives its mail. Mailclaw configures email routing and, when available and selected, email sending before helping you create the first mailbox. Resend and Amazon SES are alternatives to Cloudflare for receiving and sending; see [Sending and receiving providers](providers.md).

Check [Cloudflare plans and limits](#cloudflare-plans-and-limits) first: on the free Workers plan, Cloudflare cannot send mail for you and every request gets 10 ms of CPU.

## Before you start

- **A domain on Cloudflare DNS**, in the same Cloudflare account you deploy to. Mailclaw manages its MX, SPF, DKIM and DMARC records through the Cloudflare API.
- **R2 activated on the account.** Open **R2 Object Storage** in the Cloudflare dashboard once and complete the sign-up (Cloudflare can ask for a payment method; usage inside the free allowance is billed at $0). The deploy creates the `mailclaw-raw` bucket only when R2 is already active. Otherwise it creates the D1 database and the queues, then stops with `R2 bucket 'mailclaw-raw' not found [code: 10085]`. Activate R2 and retry the deploy; what was already created is reused.
- **Workers Paid, if Cloudflare should send your mail.** On the free plan, choose Resend or Amazon SES for sending instead (see [Cloudflare plans and limits](#cloudflare-plans-and-limits)).

## Two different Cloudflare tokens

A Cloudflare install involves two API tokens. They are not interchangeable.

| | Build token | Runtime token (`CF_TOKEN`) |
| --- | --- | --- |
| Who creates it | Cloudflare, automatically, when you use **Deploy to Cloudflare** or connect a Git repository (Workers Builds). Running `npm run deploy` yourself uses your own Wrangler login instead. | You, by following [Step 1](#step-1-create-the-runtime-token-cf_token) |
| What uses it | The build, to upload the Worker and create the D1 database, R2 bucket and queues | Mailclaw itself, while running, to manage DNS and Email Routing for your domains |
| Where it lives | The Worker's build settings | A secret on the Worker named `CF_TOKEN` |

The build token never reaches the running app, so Mailclaw cannot use it, and it lacks the DNS and Email Routing permissions anyway. Do not copy it into `CF_TOKEN`, and do not delete it: builds stop working without it. If your token list shows a token you did not create, it is most likely the build token.

## Step 1: Create the runtime token (CF_TOKEN)

`CF_TOKEN` is a scoped Cloudflare API token. Create it before deploying, so you can paste it when the deploy asks for it.

1. In the Cloudflare dashboard, open **Manage Account → Account API Tokens** and select **Create Token**, then start a custom token. (A user token from **My Profile → API Tokens** works too; an account token keeps working if the person who created it leaves the account.)
2. Name it, for example `mailclaw-runtime`.
3. **First policy: your domains.** For the resources, choose the specific zones (domains) you plan to connect, or all zones of the account. Add these permissions:

   | Group | Permission | Access | Why |
   | --- | --- | --- | --- |
   | DNS & Zones | Zone | Read | Find the zone of each domain you add |
   | DNS & Zones | DNS | Edit | Create MX, SPF, DKIM and DMARC records, and replace another provider's MX records after you confirm |
   | DNS & Zones | Zone Settings | Edit | Enable Email Routing on the zone |
   | Email & Messaging | Email Routing Rules | Edit | Create the rule that sends each mailbox's mail to the Worker |

4. **Second policy, only if Cloudflare will send your mail:** add a policy whose resource is the entire account, with **Email & Messaging → Email Sending → Edit**. This needs Workers Paid; skip it when you send through Resend or SES.
5. Create the token and copy the secret it shows. Cloudflare shows it only once.

Use only the token secret: no `Bearer` prefix, not the token ID. The token must belong to the same Cloudflare account as the domains you connect. To check it, see [error 9109](troubleshooting.md#cloudflare-error-9109-invalid-access-token).

To send through Cloudflare (Workers Paid), also onboard the domain: **Compute → Email Service → Email Sending → Onboard domain**. After Mailclaw is set up, expand the domain under **Admin → Domains** to configure its DKIM and DMARC records.

## Step 2: Deploy mailclaw

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/llypeDev/mailclaw)

Click **Deploy to Cloudflare**, or run `npm install` and `npm run deploy` from a clone, or connect the repository to a Cloudflare Git integration. Every path builds the Worker and uploads it to the account you authenticated with.

1. Choose the Cloudflare account that owns the domain you want to use.
2. Set the app name to exactly `mailclaw`. Do not rename it.
3. Create (or select) the D1 database `mailclaw`. From a clone, run `npx wrangler d1 create mailclaw` and paste the printed id into `wrangler.jsonc`; the button offers to create it during onboarding.
4. Paste the runtime token from Step 1 into the `CF_TOKEN` field. Without the button, add it afterwards under **Workers & Pages → mailclaw → Settings → Variables and Secrets** as a secret named `CF_TOKEN`, or run `npx wrangler secret put CF_TOKEN`. This is not the build token Cloudflare uses to deploy the app.
5. Wait for Cloudflare to finish provisioning and deploying the Worker.

The build runs on the Node version in `.nvmrc`, which Workers Builds reads. Workers Builds installs dependencies with its own npm (10.9.2 unless `package.json` names another in `packageManager`), so a `package-lock.json` written by a newer npm can fail `npm ci` there. Variables the build itself needs, such as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, go in the build's own variables under **Settings → Build**; everything the running app reads goes under **Settings → Variables and Secrets**.


### Optional Web Push configuration

To enable background new-mail notifications, run `npm run push:keys` once and
store `VAPID_PRIVATE_KEY` as a Worker secret. Configure `VAPID_PUBLIC_KEY` and
`VAPID_SUBJECT` as Worker variables; the subject must be a `mailto:` URI or the
public HTTPS URL of the installation. The same VAPID key pair should be kept
across deployments so existing browser subscriptions remain valid.

## Step 3: Complete mailclaw setup

1. Open the URL of the deployed `mailclaw` Worker.
2. Go to `/setup` if Mailclaw does not take you there automatically.
3. Let Mailclaw check the required Cloudflare configuration and initialize the empty D1 database.
4. Create the first admin account when prompted.

Setup applies the committed migrations through the Worker's D1 binding before creating the first admin account.

To store data in PostgreSQL, MySQL, Turso/libSQL or another database instead of D1, set `DATABASE_URL` (and `DATABASE_DRIVER` when it cannot be inferred) as a Worker variable or secret before running setup. The same setup and **Update database** flow then applies that database's migrations. See [Databases](databases.md).

## Step 4: Connect your primary domain and create an account

1. Enter a domain that already uses Cloudflare DNS on the same account as your `CF_TOKEN`.
2. Continue while Mailclaw enables Email Routing and configures the required routing and sending DNS.
3. Choose the address for your first mailbox and finish setup.
4. Open the inbox and send a test message to the new address.

On Workers Free, Cloudflare refuses to turn on Email Sending. Setup then finishes anyway with the domain set up to receive only (sending provider `none`) and says so; choose Resend or Amazon SES for sending on the Domains page, or turn Cloudflare sending on there after upgrading to Workers Paid.

To connect more domains later, open **Admin → Domains**, select **New domain**, enter the hostname and choose the receiving service. With Cloudflare, Mailclaw configures Email Routing and, on Workers Paid, Email Sending automatically. With Resend or Amazon SES, add the provider's credentials and run its setup from the domain page; see [Sending and receiving providers](providers.md). The `CF_TOKEN` is still needed in every case, because Cloudflare manages the domain's DNS.

Resend and SES receive mail by calling your app, so set `APP_URL` to the app's public HTTPS address before setting them up for receiving.

Your inbox should be ready to send and receive emails

---

## Deploy with an AI coding agent

Paste the prompt below into an agent with terminal access. Give it your Cloudflare account ID and **two separate scoped API tokens** through the agent's secret input. Never put them in a public chat, repository, or committed file.

- **Deployment token** (Wrangler uses it as `CLOUDFLARE_API_TOKEN`): scope it to the target account with **Workers Scripts Edit** (or **Workers Admin** if you see Cloudflare's newer roles), **D1 Edit**, **Workers R2 Storage Edit**, **Queues Edit**, and **Account Settings Read**. Add **Workers Routes Edit** for the target zone only if the agent should attach a custom domain or route. See Cloudflare's [token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) and [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/).
- **Runtime token** (stored as the Worker secret `CF_TOKEN`): use the domain permissions above. Add **Email Sending Edit** to send mail. It must cover the zones you will connect in Mailclaw.

Activate R2 in the dashboard before the agent deploys (see [Before you start](#before-you-start)); a token cannot do that for you.

```text
Install Mailclaw from this repository in my Cloudflare account.
Ask me for my Cloudflare account ID, a scoped deployment API token, and a separate
runtime CF_TOKEN through a secret input. Never print, commit, or place either token
in a command argument or a tracked file. Use the deployment token only for Wrangler
authentication (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID).

Read README.md, docs/deployment.md, and wrangler.jsonc first. Keep the Worker name
exactly mailclaw. In the selected account, create or reuse the D1 database
mailclaw, R2 bucket mailclaw-raw, Queues mailclaw-inbound, mailclaw-outbound
and mailclaw-agent, and the dead-letter queues mailclaw-inbound-dlq and
mailclaw-outbound-dlq. Set the D1 database_id in the local
Wrangler config without committing that account-specific ID. Install dependencies,
run npm run deploy, and set the runtime CF_TOKEN as a Worker secret. Do not run
remote D1 migrations manually; the /setup flow initializes the database.

Give me the deployed URL and any remaining Cloudflare account actions. I will
open /setup, create the first admin account, and connect my domain there.
```

## Manual deployment

Install dependencies, configure the Cloudflare bindings in `wrangler.jsonc`, and run:

```bash
npm install
npm run deploy:local
```

The local deploy command builds with vinext and uploads the complete Worker with Wrangler. The Cloudflare Vite plugin generates `dist/server/wrangler.json` and redirects Wrangler to that build. It does not modify D1. The complete Worker is required because `worker.ts` also handles inbound email, queues, scheduled backups, and the real-time Durable Object.

For manual recovery, pending migrations can still be applied with:

```bash
npm run db:migrate:remote
```

Remote migrations require the target account's `database_id` in your local `wrangler.jsonc`. Do not commit an account-specific database ID to a reusable repository.

## Queues, retries and dead-letter queues

Incoming mail, scheduled and undo-window sends, webhook deliveries and import batches are processed from Cloudflare Queues. `wrangler.jsonc` declares three queues and two dead-letter queues:

| Queue | Carries | Retries | Dead-letter queue |
| --- | --- | --- | --- |
| `mailclaw-inbound` | Each received message, after its raw MIME is stored in R2 | 5 | `mailclaw-inbound-dlq` |
| `mailclaw-outbound` | Scheduled and undo-window sends, webhook deliveries, import batches | 5 | `mailclaw-outbound-dlq` |
| `mailclaw-agent` | Assistant auto-draft jobs | 3 | none (dropped after the last retry) |

The inbound and outbound consumers take one message per invocation, so each message gets the whole CPU and memory budget and a message that crashes the Worker does not cost others an attempt. A failed message is retried with a growing delay (10 s, 30 s, 90 s, 4.5 min, then 13.5 min, about 20 minutes in all), long enough to ride out a short D1, R2 or mail provider outage. After its fifth retry it moves to the dead-letter queue.

**Create the dead-letter queues once.** Cloudflare creates a missing dead-letter queue when the consumer is deployed, and Wrangler does not check that it exists, so a deploy works either way. To be sure they exist before the first push, create them yourself with an account that can edit Queues:

```bash
npx wrangler queues create mailclaw-inbound-dlq
npx wrangler queues create mailclaw-outbound-dlq
```

**What a dead message means.** Mailclaw does not consume the dead-letter queues: a message there waits, untouched, until Cloudflare deletes it (four days without a consumer, according to Cloudflare's documentation; Workers Free keeps queue messages for 24 hours). The Worker logs `Queue processing failed for the last time` with the queue name and the error when it gives up on a message, so check **Observability** for the cause first.

**Replaying a dead message.** Once the cause is fixed, open **Storage & Databases → Queues → mailclaw-inbound-dlq** (or `-outbound-dlq`) in the dashboard, list its messages, copy a message body and send it to the main queue (`mailclaw-inbound` or `mailclaw-outbound`) from that queue's page. Replaying is safe: the inbound consumer skips a message already stored for the same mailbox, and an outbound send only runs while its job is still queued. An inbound message body names the raw MIME object in R2, which the orphan sweeper keeps for 30 days, so a dead inbound message can be replayed for that long (or as long as the queue keeps it).

**Cost on Workers Free.** Every retry is one more queue operation, out of 10,000 a day. A message that is processed first time costs about 3 operations; one that fails all six deliveries and lands in the dead-letter queue costs about 8.

## Settings in wrangler.jsonc

A few Worker settings are set in `wrangler.jsonc` rather than left to defaults, so the next deploy applies them whatever the dashboard says:

- **`placement: { "mode": "smart" }`**: Cloudflare runs the Worker's HTTP handler near the D1 database rather than near the visitor, since a page load makes several database calls one after another. Only `fetch` is placed; incoming mail, queues and cron runs are unaffected. Nothing to configure.
- **`workers_dev: true`**: the `https://mailclaw.<your-subdomain>.workers.dev` address stays on. Without a custom domain it is the only public URL; see [Custom domain for the app](#custom-domain-for-the-app) before turning it off.
- **`preview_urls: false`**: preview URLs stay off. They are public and would expose every uploaded version of the Worker.

## Cloudflare plans and limits

Mailclaw has no paid features, but the Cloudflare account it runs on has a plan. Workers Free costs nothing and caps usage per day; Workers Paid has a $5 per month minimum, includes monthly allowances and then bills per use. Figures from Cloudflare's [limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/) pages in November 2026; check them for current values.

**What works on Workers Free**

- **Receiving through Cloudflare Email Routing:** yes.
- **Sending through Cloudflare:** no. Cloudflare Email Sending needs Workers Paid; enabling it on a free account fails with an authorization error. Send through [Resend or Amazon SES](providers.md) instead; both have free allowances.
- **CPU time:** 10 ms per HTTP request and per cron run, against 30 seconds by default (up to 5 minutes) on Paid. Some of Mailclaw's work takes longer than that by nature: checking a password is deliberately slow, and parsing an incoming message with a 1 MB attachment took about 30 ms in local measurements. A request over the budget fails with error 1102 (Worker exceeded resource limits); the first production install on Workers Free saw that error on the inbox page. Queue consumers, which is where incoming mail is parsed, get 30 seconds of CPU by default according to Cloudflare's Queues limits page. The Email Routing handler that first receives a message stays cheap: it scans the message for the attachment limits instead of parsing it (about 7 ms for an 18 MB message in local measurements).

**Quotas**

| Service | Workers Free | Workers Paid (included, then billed) | What uses it in Mailclaw |
| --- | --- | --- | --- |
| Worker requests | 100,000 per day | 10 million per month | Every page load and API call. Static files do not count. Opening the inbox takes about seven requests. |
| Subrequests per invocation | 50 external, 1,000 to Cloudflare services | 10,000 by default | D1 and R2 calls count as subrequests; webhooks, push, spam lookups and Resend or SES calls are external. |
| D1 rows read | 5 million per day | 25 billion per month | Every row a query scans, not only the rows it returns. |
| D1 rows written | 100,000 per day | 50 million per month | Every row written, plus one per index updated. |
| D1 queries per invocation | 50 | 1,000 | A batch of statements sent together (`db.batch`) counts as one query. Processing one incoming message makes around 18 queries, and the queue hands each invocation one message. |
| D1 database size | 500 MB per database (5 GB per account) | 10 GB per database | Every message's headers, text and HTML body, plus the search index over them. Raw messages and attachments are in R2. |
| Queues | 10,000 operations per day, 24-hour retention | 1 million operations per month | About 3 operations per message across the inbound, outbound and assistant queues: roughly 3,300 messages a day on Free, counting received mail, scheduled sends, webhook deliveries and import batches. Each retry adds one; see [Queues, retries and dead-letter queues](#queues-retries-and-dead-letter-queues). |
| Durable Objects | 100,000 requests and 13,000 GB-s per day | 1 million requests and 400,000 GB-s per month | One realtime connection hub per signed-in user; small with hibernation. |
| Cron triggers | 5 per account | 250 per account | Mailclaw uses 2 (daily backups and a five-minute job). |
| R2 | 10 GB-month storage, 1 million Class A and 10 million Class B operations per month (same on both plans) | | Raw mail, attachments, Drive files and backups. |

When a daily Free quota runs out, the service refuses further work until 00:00 UTC: D1 queries fail, so sign-in, the inbox and incoming-mail processing all return errors until the reset.

**Which plan to use** is your call. Workers Free is enough to try Mailclaw, or for a light personal install that sends through Resend or SES. Workers Paid is the recommended choice for daily use by several people, because it removes the limits most likely to break it: the 10 ms CPU budget, the 50 D1 queries per invocation, the daily caps that stop the app until midnight UTC, the 500 MB database, and the lack of Cloudflare sending.

## Custom domain for the app

The first deploy publishes Mailclaw at `https://mailclaw.<your-subdomain>.workers.dev`. Serving it from a hostname on one of your zones, such as `mail.example.com`, is recommended: Cloudflare features such as the Cache API (it does nothing on `workers.dev`), cache rules, WAF custom rules and rate limiting rules apply only to traffic on your own zones.

1. Open **Workers & Pages → mailclaw → Settings → Domains & Routes → Add → Custom domain**.
2. Enter the hostname, for example `mail.example.com`. It must be on a zone in the same account; Cloudflare creates the DNS record and the certificate.
3. Set the Worker variable `APP_URL` to `https://mail.example.com`.

Do this before people register passkeys: a passkey is bound to the hostname it was created on, so passkeys registered on the `workers.dev` address do not work on the custom domain. Signed-in sessions also do not carry over, since cookies belong to a hostname.

Once the custom domain works, you can turn off the `workers.dev` address by setting `workers_dev` to `false` in `wrangler.jsonc` (it is set to `true` there). Change it there rather than in the dashboard: the next deploy applies the value in the file.

## D1 read replication

Mailclaw already reads through the D1 Sessions API: each browser keeps a bookmark in the `mf-d1-bm` cookie, so its reads can come from a nearby replica while it still sees its own writes. Sign-in, setup and inbound endpoints always use the primary. Until replication is turned on for the database, every read still goes to the primary.

To turn it on, open **Storage & Databases → D1 → mailclaw → Settings → Enable Read Replication**, or call the API with a token that has **D1 Edit**:

```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/<account_id>/d1/database/<database_id>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  --data '{"read_replication":{"mode":"auto"}}'
```

A `GET` on the same URL shows `"read_replication": {"mode": "auto"}` when it is on. Cloudflare charges nothing extra for replicas: rows read and written are billed exactly as without them. Replicas exist in every D1 region (ENAM, WNAM, WEUR, EEUR, APAC, OC). This applies only to D1; it does nothing when `DATABASE_URL` points at another database.

## Object storage (R2, Backblaze B2 or AWS S3)

Raw mail, attachments, Drive files, avatars, branding icons, JMAP uploads and backups all live in one bucket. By default that is the `BUCKET` R2 binding in `wrangler.jsonc`. To use Backblaze B2 instead, set four Worker variables (as secrets, or in `.dev.vars` locally):

| Variable | Example | Purpose |
| --- | --- | --- |
| `B2_KEY_ID` | `004abc...` | Application key ID |
| `B2_APPLICATION_KEY` | `K004...` | Application key secret |
| `B2_BUCKET` | `mailclaw` | Bucket name |
| `B2_ENDPOINT` | `s3.us-west-004.backblazeb2.com` | S3-compatible endpoint from the bucket page; the region is read from it |

```bash
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
npx wrangler secret put B2_BUCKET
npx wrangler secret put B2_ENDPOINT
```

To use AWS S3 instead, set `S3_BUCKET`, `S3_REGION` and credentials: `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, which fall back to `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` so one IAM user can serve SES and storage. The bucket must be private and in the named region; the IAM user needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:AbortMultipartUpload` on `arn:aws:s3:::<bucket>/*`. If both are configured, B2 wins.

When all four B2 variables (or the S3 ones) are present that storage replaces R2 everywhere; with any missing, R2 stays in use (a partial setup is reported by `GET /api/v1/storage`). The R2 binding can stay in `wrangler.jsonc` and is simply unused. Use a bucket-restricted application key with read and write access, and keep the bucket private. Notes:

- **Switching does not copy data.** Objects already in R2 are not moved; copy them to the bucket first (for example with `rclone`, keeping the same keys) or old mail bodies, attachments and Drive files will report as missing.
- **Drive upload parts** are buffered one at a time in the Worker (64 MB each). B2 and S3 require every part but the last to be at least 5 MB, which holds.
- **Lifecycle.** Set the bucket's lifecycle rule to keep only the last version and to delete unfinished large files after a few days, as R2 would abort incomplete multipart uploads.
- **Test it** with `POST /api/v1/storage` (admin key with the `storage` scope), or the `manage_storage` MCP tool with `action: "test"`; it writes, reads and deletes a small object.

### Expire the bucket's cache prefixes

Three prefixes in the bucket only ever grow, and nothing in them is needed for long:

| Prefix | What it holds | Safe to expire after |
| --- | --- | --- |
| `spam-cache/` | Cached results of spam lookups (Spamhaus, URLhaus, domain age). A missing entry is looked up again. | 30 days |
| `sns-seen/` | Empty markers of SES notifications already processed, so a replayed notification is ignored. SNS signatures stay valid for 24 hours. | 7 days |
| `relay-seen/` | Empty markers of relay requests already processed (self-hosted relay only). Relay signatures stay valid for 5 minutes. | 1 day |

Mailclaw now files the `sns-seen/` and `relay-seen/` markers by time window and deletes expired windows itself as new markers are written, so for those two prefixes the rule is only a backstop (it also removes markers written by older versions). `spam-cache/` still needs the rule.

Do not add a rule for any other prefix: everything else is mail, attachments, Drive files or backups. In particular, leave `system/` alone: it holds the raw-mail sweeper's position.

**R2.** In the dashboard, open **R2 Object Storage → mailclaw-raw → Settings → Object Lifecycle Rules → Add rule**, set the prefix and **Delete objects** after the number of days above, and save. With Wrangler (rule name, then prefix):

```bash
npx wrangler r2 bucket lifecycle add mailclaw-raw expire-spam-cache spam-cache/ --expire-days 30
npx wrangler r2 bucket lifecycle add mailclaw-raw expire-sns-seen sns-seen/ --expire-days 7
npx wrangler r2 bucket lifecycle add mailclaw-raw expire-relay-seen relay-seen/ --expire-days 1
npx wrangler r2 bucket lifecycle list mailclaw-raw
```

R2 removes expired objects within about a day of their expiry. Buckets already have a default rule that aborts incomplete multipart uploads after 7 days; keep it.

**Backblaze B2.** On the bucket's **Lifecycle Settings**, choose custom rules and add one per prefix, keeping any rule you already have (for example "keep only the last version"):

```json
[
  { "fileNamePrefix": "spam-cache/", "daysFromUploadingToHiding": 30, "daysFromHidingToDeleting": 1 },
  { "fileNamePrefix": "sns-seen/", "daysFromUploadingToHiding": 7, "daysFromHidingToDeleting": 1 },
  { "fileNamePrefix": "relay-seen/", "daysFromUploadingToHiding": 1, "daysFromHidingToDeleting": 1 }
]
```

**AWS S3.** In the bucket's **Management → Lifecycle rules**, create one rule per prefix that expires current versions after the days above. With the AWS CLI, note that `put-bucket-lifecycle-configuration` replaces the whole configuration, so include any rule you already have:

```json
{
  "Rules": [
    { "ID": "expire-spam-cache", "Filter": { "Prefix": "spam-cache/" }, "Status": "Enabled", "Expiration": { "Days": 30 } },
    { "ID": "expire-sns-seen", "Filter": { "Prefix": "sns-seen/" }, "Status": "Enabled", "Expiration": { "Days": 7 } },
    { "ID": "expire-relay-seen", "Filter": { "Prefix": "relay-seen/" }, "Status": "Enabled", "Expiration": { "Days": 1 } },
    { "ID": "abort-multipart", "Filter": {}, "Status": "Enabled", "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 } }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://lifecycle.json
```

The self-hosted runtime without B2 or S3 keeps these prefixes as folders under `/data/blobs`; if they grow, delete old files from a scheduled job, for example `find /data/blobs/spam-cache -type f -mtime +30 -delete`.

## Worker variables and secrets

Set these under **Workers & Pages → mailclaw → Settings → Variables and Secrets** (store keys and passwords as secrets), with `npx wrangler secret put <NAME>`, or in `.dev.vars` for local development. `wrangler.jsonc` sets `keep_vars`, so deploys keep what you set in the dashboard. Several of them can also be set in the app; a value saved in the app wins over the variable. The self-hosted runtime has its own list in [Self-hosting](self-hosting.md#configuration-reference).

| Variable | Needed for |
| --- | --- |
| `CF_TOKEN` | Required. The runtime API token from [Step 1](#step-1-create-the-runtime-token-cf_token). |
| `CF_EMAIL`, `CF_API_KEY` | Legacy alternative to `CF_TOKEN`: account email plus Global API Key. |
| `CF_EMAIL_WORKER_NAME` | Worker that Email Routing rules deliver to; defaults to `mailclaw`. Set it only if you deploy the Worker under another name, and change `services[].service` in `wrangler.jsonc` to match. Rules created before a change keep the old name. |
| `APP_URL` | Public HTTPS address of the app, without a trailing slash. Needed for Resend or SES receiving, and used for links in mail, passkeys, JMAP and the read-receipt pixel. |
| `TURNSTILE_SECRET_KEY` | Turnstile bot check on the sign-in and first-run forms. Pair it with `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, which is read at build time, so it goes in the build's variables. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push notifications; see [Optional Web Push configuration](#optional-web-push-configuration). |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` | Native push to the iOS app straight through Apple: the key ID, your Apple team ID and the contents of the `.p8` key file. Keep the private key a secret. |
| `APNS_RELAY_URL` | Native push through a Mailclaw push relay (`https://` origin) instead of your own Apple key. Devices choose per registration; a device registered through the relay gets no push without it. |
| `RESEND_API_KEY` | Resend key, used when none is saved on the Domains page. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Amazon SES credentials, used when none are saved on the Domains page. `AWS_DEFAULT_REGION` is read when `AWS_REGION` is unset. |
| `SPAMHAUS_DQS_KEY` | Spamhaus Data Query Service key: checks the sending IP (ZEN) and domains (DBL) of incoming mail. Can also be set under **Admin → Spam filter**. |
| `ABUSECH_AUTH_KEY` | abuse.ch Auth-Key: checks links in incoming mail against URLhaus. Can also be set under **Admin → Spam filter**. |
| `SPAM_DOMAIN_AGE_CHECK` | `off` disables the domain-age lookups to rdap.org for every mailbox, whatever the Spam filter page says. |
| `B2_*`, `S3_*` | Backblaze B2 or AWS S3 instead of R2; see [Object storage](#object-storage-r2-backblaze-b2-or-aws-s3). |
| `DATABASE_URL`, `DATABASE_DRIVER`, `DATABASE_AUTH_TOKEN` | A database other than D1; see [Databases](databases.md). |
| `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY` | Assistant model: `AI_MODEL` overrides the Workers AI model; the other two point at an OpenAI-compatible API instead. |
| `GITHUB_UPDATE_TOKEN`, `GITHUB_UPDATE_REPO`, `GITHUB_UPDATE_REF`, `GITHUB_UPDATE_SOURCE_REPO` | The in-app update button; see [Auto update](#auto-update). |

For local development only, `CLOUDFLARE_REMOTE_BINDINGS=true` in the shell makes `npm run dev` use the bindings marked remote in `wrangler.jsonc` against your Cloudflare account instead of local stand-ins.

## Database backups

Mailclaw exports its D1 records as JSON and stores the backup files in the configured storage bucket (R2, or Backblaze B2 when configured). A cron trigger in `wrangler.jsonc` runs daily at 02:00 UTC and applies the schedule selected under **Admin → Backups**. Manual backups run the same record export directly from the admin API.

Deploy the complete Worker with `npm run deploy` whenever the cron trigger is added or changed.

After upgrading an existing installation and confirming the cron trigger is active, the old Workflow can be removed with `npx wrangler workflows delete mailclaw-database-backup`. Deleting it also removes its historical Workflow instances; backup files in storage and rows in Mailclaw's backup history are unaffected.

### Other scheduled jobs

The two cron triggers also run Mailclaw's upkeep; none of it needs configuring:

- **Every five minutes:** follow-up and calendar reminders, assistant job recovery, stale import jobs, and sends left in "sending" for over 15 minutes by a delivery that never finished (they are marked failed rather than sent again, since the provider may have accepted them). Trash and Spam clean-up runs on the tick at minute 0 of each hour, up to 200 messages per run.
- **Daily at 02:00 UTC:** backups, purging deleted accounts, emptying Drive trash, pruning the JMAP change log, deleting raw messages in R2 that no stored message refers to (only objects older than 30 days, so a message waiting in a queue or dead-letter queue keeps its raw MIME), and `PRAGMA optimize`, which refreshes the SQLite query planner's statistics on D1 (it does nothing on PostgreSQL or MySQL). On MySQL the daily run also recounts the sidebar message counters.

The self-hosted server runs the same jobs from its own scheduler.

## Email assistant and MCP

The assistant uses the Workers AI `AI` binding and a separate `mailclaw-agent` queue. Provision the queue in the Cloudflare account before deploying a configuration that declares it, and apply migration `0032_add_agentic_mail.sql` before opening the new UI on an existing database. The five-minute cron recovers pending auto-draft work; the 02:00 UTC cron still runs backups.

In the inbox, open **Assistant → Settings** for a mailbox, select its reviewer, and enable the assistant. Auto-drafting is a separate opt-in. It skips spam, automated mail, and mailboxes with out-of-office replies enabled. Generated replies appear as ordinary drafts assigned to the reviewer. The reviewer must open the draft and confirm the exact content before delivery.

The assistant panel no longer exposes MCP key management. External MCP clients can still connect to `https://<your-mailclaw-origin>/mcp` with a mailbox-scoped Bearer key created through the authenticated `/api/agent/mcp-keys` endpoint. Keys can be listed and revoked through that endpoint; a new key is shown only once. The server uses Streamable HTTP and accepts clients that can set a Bearer header. Its `request_send` tool returns a Mailclaw review URL; the MCP key cannot confirm or deliver messages directly. MCP does not require Workers AI for read and draft tools.

## Updating Mailclaw

The **Update Mailclaw** button in the admin dashboard dispatches `.github/workflows/deploy-update.yml` in the installation repository. The workflow replaces the installation branch's complete tracked tree with the latest upstream source, commits that replacement, and pushes it. This avoids merge conflicts between independently created installation and upstream histories. Target-only committed files and code changes are intentionally removed; repository variables, secrets, and other GitHub or Cloudflare configuration remain unchanged. A connected Cloudflare Git integration then builds and deploys the change.

### Auto update

Create a fine-grained personal access token for the installation repository with these repository permissions:

| Permission | Access | Used for |
| --- | --- | --- |
| Actions | Read and write | Dispatching `deploy-update.yml` from the Mailclaw admin dashboard |
| Contents | Read and write | Committing and pushing the upstream source into the installation repository |
| Workflows | Read and write | Replacing files inside `.github/workflows` during an update |

Configure the token and repository details in both Cloudflare and GitHub:

| Location | Name | Type | Value |
| --- | --- | --- | --- |
| Cloudflare Worker | `GITHUB_UPDATE_TOKEN` | Secret | The fine-grained personal access token |
| Cloudflare Worker | `GITHUB_UPDATE_REPO` | Variable | The installation repository in `owner/repository` format |
| Cloudflare Worker | `GITHUB_UPDATE_REF` | Optional variable | The installation branch to update; omit it to use the repository's default branch |
| Cloudflare Worker | `GITHUB_UPDATE_SOURCE_REPO` | Variable | The repository that publishes your releases, in `owner/repository` format; the admin dashboard compares versions against it. Without it the update card lists it as missing and cannot check for updates. |
| GitHub repository → Actions | `MAILCLAW_UPDATE_TOKEN` | Repository secret | The same fine-grained personal access token |
| GitHub repository → Actions | `UPDATE_SOURCE_REPOSITORY` | Repository variable | The repository that publishes your releases, in `owner/repository` format |

The same token can be used for `GITHUB_UPDATE_TOKEN` and `MAILCLAW_UPDATE_TOKEN` when it has all three permissions above. Keep both values secret and limit the token's repository access to the installation repository.

Make sure `.github/workflows/deploy-update.yml` exists on the installation branch; it ships with this repository. If an older installation has a different updater, replace it with this file once. A running workflow cannot create or replace itself until the current workflow has been installed manually.

After the GitHub Action completes successfully, wait for the connected Cloudflare deployment to finish before refreshing Mailclaw or applying pending database migrations. The workflow updates the repository first; the new application version is not live until Cloudflare completes its deployment.

Deployment and database migration are separate. After Cloudflare deploys a repository push or an admin-triggered update, open or refresh **Admin settings**. The application update card shows any pending database migrations. Select **Update database** to apply them through the Worker's D1 binding. The same runner initializes a new database during setup.

If the Cloudflare dashboard has a custom deploy command containing `wrangler d1 migrations apply DB --remote`, remove that part and use `npm run deploy`.

Each migration and its `d1_migrations` history entry run in one D1 batch. If a migration fails, its changes are rolled back, the failed filename is shown, and it can be retried after the problem is corrected. After applying migrations the runner runs `PRAGMA optimize`, so new indexes get planner statistics straight away. Wrangler remains available as a manual recovery tool.

New application releases must remain compatible with the previous schema until an administrator applies their migrations. Prefer additive changes, keep old columns during the transition, and avoid making authentication or the admin settings page depend immediately on a newly added column. Plan a maintenance window for an incompatible schema change.

When adding a schema change, create a new uniquely named SQL file in `drizzle/migrations` and do not edit an applied migration. Build and development commands generate the Worker migration bundle from those files. `npm run db:bundle` can generate it explicitly.

## Branding

The application name, icon and favicon are set under **Admin → Branding**. There is nothing to activate: every installation can rename itself.
