# Troubleshooting

## Deploy fails: R2 bucket 'mailclaw-raw' not found (code 10085)

R2 is not activated on the Cloudflare account. The deploy creates the bucket only when R2 is active, so it creates the D1 database and queues and then stops at this error. Open **R2 Object Storage** in the dashboard, complete the sign-up, and retry the deploy; the database and queues it already created are reused.

## Cloudflare build fails at npm ci

Workers Builds installs dependencies with npm 10.9.2 unless `package.json` names another version in `packageManager`. A `package-lock.json` rewritten by a newer npm (npm 11 ships with Node 24) can be rejected there even though it installs locally. Regenerate or check the lockfile with the same npm, for example `npx npm@10.9.2 install`, and commit the result. The Checks workflow runs `npm ci` with the same npm, so it fails on the same lockfile.

## Error 1102: Worker exceeded resource limits

On the free Workers plan each request gets 10 ms of CPU, and some Mailclaw requests need more. See [Cloudflare plans and limits](deployment.md#cloudflare-plans-and-limits). In the Worker's **Observability** logs, an `exceededCpu` outcome confirms it.

## Cloudflare error 9109: Invalid access token

The Deploy to Cloudflare flow can deploy the Worker, but its build token is not exposed to Mailclaw at runtime. Create a separate Cloudflare API token and set it as `CF_TOKEN`; see [Two different Cloudflare tokens](deployment.md#two-different-cloudflare-tokens).

Verify the token:

```bash
# Token created under My Profile → API Tokens
curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer <CF_TOKEN>"

# Token created under Manage Account → Account API Tokens
curl "https://api.cloudflare.com/client/v4/accounts/<account_id>/tokens/verify" \
  -H "Authorization: Bearer <CF_TOKEN>"
```

The response should report `success: true` and an active status. Check that:

- `CF_TOKEN` contains the token secret, not its ID.
- The value does not include the word `Bearer`.
- The token is currently valid and its IP restrictions allow the Worker.
- You redeployed after changing Cloudflare variables or secrets.

If you use a legacy Global API Key, set `CF_EMAIL` and `CF_API_KEY` instead of placing it in `CF_TOKEN`.

## Cloudflare error 2036 when enabling sending

Enabling Cloudflare Email Sending answers 401 with code 2036 most often because the account is on the free Workers plan: Cloudflare sending needs Workers Paid. Upgrade, or choose Resend or Amazon SES as the domain's sending provider. If the account is on Paid, check that `CF_TOKEN` has **Email Sending Edit** on the account.

When this happens while adding a domain that also receives through Cloudflare (including the first domain during setup), Mailclaw no longer fails the whole setup: it adds the domain receive-only, with sending provider `none` (setup says "Cloudflare would not turn on sending … set up to receive mail only"). Mail arrives normally; to send, pick Resend or Amazon SES on the Domains page, or turn Cloudflare sending on there after upgrading. A 403 from Cloudflare is handled the same way.

## "Cross-site request blocked" (HTTP 403)

The server refuses a change made with the session cookie when the request's `Origin` is not the app's own origin; see [Security notes](security.md#cross-site-requests).

- **Self-hosted behind a reverse proxy, every save fails:** the server cannot tell the public address. Set `TRUST_PROXY=1` and have the proxy send `X-Forwarded-Proto` and the original `Host`; see [Self-hosting](self-hosting.md#quick-start).
- **A script, browser extension or another page on a sibling subdomain calls the API with the session cookie:** use an API key (`Authorization: Bearer <key>`) instead; Bearer requests are not checked.

## Messages in a dead-letter queue

`mailclaw-inbound-dlq` or `mailclaw-outbound-dlq` holds messages the Worker failed to process six times in a row (about 20 minutes of retries). The Worker's **Observability** logs show `Queue processing failed for the last time` with the queue and the error for each one. Fix the cause (a full D1 quota on Workers Free, a missing binding, a provider outage), then replay the messages as described in [Queues, retries and dead-letter queues](deployment.md#queues-retries-and-dead-letter-queues). Nothing consumes the dead-letter queues, so their messages are deleted by Cloudflare after a few days if you do nothing; an incoming message's raw MIME stays in R2 for 30 days.

## Cloudflare error 10000 on Email Routing

Update the token so it can read the zone and manage its DNS, Email Routing settings, and Email Routing rules. The recommended scoped permissions are listed in the [deployment guide](deployment.md#step-1-create-the-runtime-token-cf_token).

## Cloudflare error 2008 for existing MX records

Cloudflare Email Routing cannot be enabled while another mail provider's MX records are present. Mailclaw shows a confirmation before replacing them. Continuing deletes the existing MX records and points incoming mail to Cloudflare Email Routing, so the previous provider will stop receiving mail. The `CF_TOKEN` needs **DNS Edit** permission for this action.

## Resend or SES domain stays "not verified"

The status is the provider's own, not Mailclaw's. After the DNS records are added it can stay pending for several minutes (Resend and SES check public DNS, not Cloudflare's dashboard), and **Check status** re-asks the provider without creating anything. If one record stays stuck, look at the per-record statuses listed under the domain row, then check for a duplicate or older TXT record on the same name, a CNAME that is proxied through Cloudflare (it must be DNS only), or a record created at the wrong name (`send.example.com.example.com`). `dig TXT resend._domainkey.example.com +short` shows what the public sees.

## "This domain has MX records for another mail service"

Only one service can own a domain's MX records. Setting up a receiving provider shows the records it would replace and waits for your confirmation; confirming means the previous service stops receiving mail for that domain.

## Resend says the key can only send mail

A sending-only Resend key cannot add domains or webhooks. Replace it with a full-access key under the domain's Resend card, or add the domain in the Resend dashboard yourself (and, for receiving, create an `email.received` webhook pointing at `/api/inbound/resend`).

## SES receiving setup fails

- **Region.** SES receives mail only in some regions. Use one such as us-east-1, us-west-2 or eu-west-1.
- **Public address.** SNS must reach `/api/inbound/ses`, so `APP_URL` has to be a public HTTPS address; localhost does not work.
- **Permissions.** The AWS card lists the permissions the key lacks, with the IAM policy that grants them. Use **Re-check** after attaching it.
- **Sandbox.** An account in the SES sandbox can send only to verified addresses. Request production access in the SES console.
- **Subscription pending.** The SNS subscription confirms itself when SNS calls the endpoint; the checklist shows it as not ready until then. Use **Check again** after a minute.

## D1 error 7404: Database could not be found

D1 database IDs belong to a specific Cloudflare account. This error commonly means `wrangler.jsonc` contains an ID copied from another account.

For a reusable one-click deployment repository, remove the committed `database_id` and keep only `database_name`. Cloudflare can then provision the database in the target account.

For remote migrations after the first deployment:

1. Open the Worker's **Settings → Bindings** page in Cloudflare.
2. Open the `DB` D1 binding and copy its database ID.
3. Add that ID to your local `wrangler.jsonc`.
4. Run `npm run db:migrate:remote`.

Do not commit that account-specific ID to a reusable public repository.

## Scheduled backups are not running

Deploy the complete Worker with `npm run deploy`. A local Next.js server or a source-only update does not provision the cron trigger declared in `wrangler.jsonc`.

Also confirm that automatic backups are enabled under **Admin → Backups** and that the Worker has its `DB` and `BUCKET` bindings.

## Inbound mail is not arriving

Confirm that:

- The deployed Worker is named `mailclaw`.
- `services[].service` in `wrangler.jsonc` is also `mailclaw`.
- Email Routing is enabled for the domain in Cloudflare.
- The mailbox has an Email Routing rule pointing to the Worker.
- If the domain receives through Resend or Amazon SES instead, its receiving checklist is all green, the MX record points at that provider, and `APP_URL` is a public HTTPS address.
- `mailclaw-inbound-dlq` is empty. Mail that reached the Worker but could not be stored ends up there; see [Messages in a dead-letter queue](#messages-in-a-dead-letter-queue).
