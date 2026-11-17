<div align="center">
  <img src="assets/icon.png" alt="Mailclaw" width="132" />
  <h1>Mailclaw</h1>
  <p>
    A self-hosted alternative to Google Workspace: <b>custom domain email</b>,
    <b>Calendar</b>, <b>Drive</b>, <b>Booking</b> and <b>built-in AI agents</b>.
  </p>
  <p>
    <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/llypeDev/mailclaw">
      <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare" />
    </a>
  </p>
</div>

Run it on Cloudflare or Docker. Send and receive with Cloudflare, Resend or Amazon SES. Store files in R2, Backblaze B2 or AWS S3. Use D1, Postgres, MySQL or Turso for the database.

## Features

### Apps

- **Email**: Custom domain mailboxes, personal or shared, with access you control. Send and receive with Cloudflare Email, Resend or Amazon SES.
- **Routing rules**: Store, forward, reject or sort incoming mail.
- **Calendar**: Repeating events with time zones. Attendees get email invitations.
- **Booking**: Share a public link so anyone can book a free time on your calendar.
- **Drive**: Store and share files.
- **AI agents**: Search mail, draft replies and manage events. Connect other AI tools over MCP.

### Technical

- **Databases**: Cloudflare D1 (default), PostgreSQL, MySQL, Turso / libSQL, or a local SQLite file. Set `DATABASE_URL` to switch. Works with Supabase, Neon, PlanetScale, TiDB and more. See [Databases](docs/databases.md).
- **File storage**: Cloudflare R2, Backblaze B2 or AWS S3.
- **Hosting**: Cloudflare Workers or a single Docker container.
- **Admin**: Users, API keys, webhooks, audit logs and backups.
- **Import**: Bring in mail from IMAP, Gmail Takeout, `.eml` and `.mbox` files.

Mailclaw currently supports 34 languages, including English, Português (Brasil), Português (Portugal), Español, Français, Deutsch, Italiano, Nederlands, Polski, Українська, Русский, Türkçe, 中文（简体）, 日本語, 한국어, Bahasa Indonesia, Bahasa Melayu, Tiếng Việt, ไทย, हिन्दी, বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, ಕನ್ನಡ, മലയാളം, ਪੰਜਾਬੀ, සිංහල, Kiswahili, Hausa, plus العربية, اردو and فارسی (right-to-left).

## Cost

Mailclaw itself is free: nothing to buy or activate. What you pay depends on the Cloudflare plan of the account it runs on, and on the mail provider you send with.

| | Workers Free ($0) | Workers Paid ($5/month minimum) |
| --- | --- | --- |
| Receive through Cloudflare Email Routing | Yes | Yes |
| Send through Cloudflare | No | Yes |
| Send through Resend or Amazon SES | Yes | Yes |
| CPU time per request | 10 ms | 30 s by default, up to 5 min |
| Usage caps | Daily: 100,000 requests, D1 5 million rows read and 100,000 written, 10,000 queue operations. Once one runs out, the app returns errors until 00:00 UTC. | Monthly allowances, then billed per use |
| Database size (D1) | 500 MB | 10 GB |

Workers Free is enough to try Mailclaw, or for a light personal install that sends through Resend (3,000 emails a month free) or Amazon SES. For daily use by several people, Workers Paid is the recommended choice: checking a password or parsing a message with attachments takes more than 10 ms of CPU, and a daily cap that runs out stops sign-in, the inbox and incoming mail until midnight UTC. The full list of limits, and what in Mailclaw uses each one, is in [Cloudflare plans and limits](docs/deployment.md#cloudflare-plans-and-limits).

New Amazon SES accounts start in a sandbox. Ask AWS for production access to lift it. Prices change, so check [Resend](https://resend.com/pricing), [Amazon SES](https://aws.amazon.com/ses/pricing/) and [Cloudflare](https://developers.cloudflare.com/workers/platform/pricing/).

## Deploy

Before you start: your domain must use Cloudflare DNS in the same account, and **R2 must be activated** on that account (open **R2 Object Storage** in the dashboard once). Without R2 the first deploy stops with `R2 bucket 'mailclaw-raw' not found`.

1. **Create the runtime token.** Mailclaw calls the Cloudflare API to set up DNS and Email Routing, with a scoped API token you create and store as `CF_TOKEN`. It is not the build token Cloudflare creates for the deploy. Permissions and steps: [Step 1 in the deployment guide](docs/deployment.md#step-1-create-the-runtime-token-cf_token).
2. **Deploy the app.** Click **Deploy to Cloudflare** above, or run `npm run deploy` from a clone, and paste the token into `CF_TOKEN`. Keep the app name `mailclaw`, or it will break. The Worker needs a D1 database named `mailclaw`: the button offers to create it, and from a clone you run `npx wrangler d1 create mailclaw` and paste the id into `wrangler.jsonc`.
3. **Finish setup.** Open the app at `/setup` and create your admin account.
4. **Connect a domain.** Add a domain from the same Cloudflare account, then create your first mailbox.

More options, including a custom domain for the app and D1 read replicas: [deployment guide](docs/deployment.md).

### Deploy with an AI agent

Paste this into an AI agent that has terminal access (Claude Code, Codex, Cursor and similar):

```text
Install Mailclaw for me from https://github.com/llypeDev/mailclaw on my Cloudflare account.

1. Read README.md, docs/deployment.md and wrangler.jsonc first.
2. Ask me for my Cloudflare account ID and two API tokens, using a secret input:
   a deploy token (for Wrangler) and a runtime token (the Worker secret CF_TOKEN).
   Never print them, commit them, or pass them as command arguments.
   R2 must already be activated on the account; if it is not, ask me to do it.
3. Keep the Worker name exactly "mailclaw". Create or reuse the D1 database
   "mailclaw", the R2 bucket "mailclaw-raw", the queues "mailclaw-inbound",
   "mailclaw-outbound" and "mailclaw-agent", and the dead-letter queues
   "mailclaw-inbound-dlq" and "mailclaw-outbound-dlq".
4. Install dependencies, run `npm run deploy`, and set CF_TOKEN as a Worker secret.
   Do not run remote database migrations yourself. The /setup page does that.
5. Give me the app URL and anything I still need to do. I will open /setup, create
   the admin account and connect my domain.
```

Token permissions and more options: [deployment guide](docs/deployment.md#deploy-with-an-ai-coding-agent).

### Self-host with Docker

Runs as one container on any server, with SQLite and local files.

```bash
cp .env.docker.example .env.docker
docker compose up -d --build
```

See [self-hosting](docs/self-hosting.md).

## Local development

```bash
nvm use                # the Node version in .nvmrc
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

Cloudflare's build and CI use the Node version in `.nvmrc`. Cloudflare installs dependencies with npm 10.9.2, so if your npm is newer and you changed `package-lock.json`, check that `npx npm@10.9.2 ci` still accepts it before you push.

Add your Cloudflare credentials to `.dev.vars`, then open [localhost:3000](http://localhost:3000). Run `npm run db:seed` to load sample data.

- `npm run build`: build the Worker
- `npm run deploy`: build and deploy
- `npm run lint`: lint and type check

A schema change needs a migration for each database type. See [Databases](docs/databases.md#migrations).

## Documentation

- [Deployment and configuration](docs/deployment.md)
- [Databases](docs/databases.md)
- [Sending and receiving providers](docs/providers.md)
- [API and integrations](docs/api.md)
- [Email assistant and MCP](docs/email-assistant-and-mcp.md)
- [Adding a language](docs/localization.md)
- [Security notes](docs/security.md)
- [Spam protection](docs/spam-protection.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Self-hosting with Docker](docs/self-hosting.md)

## License

MIT. See [LICENSE](LICENSE). Every feature ships in the box: there is nothing to activate, and no account limits.
