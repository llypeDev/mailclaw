# Security notes

## Sessions

The browser's session lives only in the `ep_session` cookie, which is `httpOnly` (page script
cannot read it), `SameSite=Lax`, and `Secure` whenever the request arrived over HTTPS. The web
client keeps no credential of its own: `localStorage` holds only a random, non-secret marker
(`s1.…`) that changes when the signed-in account changes, so open tabs notice a sign-out or an
account switch.

Older versions of the web client kept the session token itself in `localStorage`. On its first
load after an upgrade, the client sends that token once to `POST /api/auth/session` (as a
`Bearer` header, so another site cannot use the endpoint to plant a session), which sets the
cookie; it then confirms with `GET /api/auth/session` that the browser kept the cookie and deletes
the stored token. If the cookie does not stick, the tab keeps using the old token until it does.

Sign-in, account switch and sign-out responses include the session token in their JSON body only
for callers that are not browsers, recognised by the absence of both `Sec-Fetch-Site` and `Origin`
(browsers always send one of them and page script cannot remove either). Scripts such as
`scripts/import-gmail-takeout.mjs` use that token as a `Bearer` credential.

## Passwords and second factor

New password hashes are scrypt (N = 2^14, r = 8, p = 1, 16-byte salt), stored as
`$scrypt$ln=14,r=8,p=1$<salt>$<hash>` so the cost can be raised later without a migration. Hashes
from older versions are bcrypt; they still verify and are replaced with scrypt on the next
successful password sign-in (web or mobile app). Checking a password costs about 40 to 60 ms of CPU,
against more than half a second for the old bcrypt setting; that is still above the 10 ms per
request of Workers Free (see [Cloudflare plans and limits](deployment.md#cloudflare-plans-and-limits)).
N = 2^14 is the most the Workers runtime accepts.

A sign-in that needs a second step creates a challenge valid for 5 minutes. It allows 5 tries at the
second factor (authenticator code, recovery code or passkey); after that the challenge is refused
and the user must sign in with the password again. The count needs migration `0088`; before it,
tries are not counted.

## Cross-site requests

Every request under `/api/` that changes something (`POST`, `PUT`, `PATCH`, `DELETE`) and carries
the session cookie (`ep_session` or the account switcher's `ep_accounts`) must come with an
`Origin` header equal to the app's own origin; otherwise the server answers
`403 {"error": "Cross-site request blocked"}` before the route runs. This is enforced centrally in
the Worker and in the self-hosted server, in addition to the checks some routes already made.
Exempt are requests authenticated with `Authorization: Bearer` (API keys, mobile app keys, scripts),
requests without a session cookie, and the endpoints that never use the session: `/api/inbound*`
(provider webhooks, which verify a signature or a secret), `/api/public/*` (booking pages) and
`/api/i/*` (the read-receipt pixel).

Self-hosted behind a reverse proxy, the server learns the public origin from `X-Forwarded-Proto`
and `X-Forwarded-Host` only when `TRUST_PROXY=1`; see [Self-hosting](self-hosting.md#quick-start).

## Content Security Policy

The app's pages send a Content Security Policy with `script-src-attr 'none'`: inline event-handler
attributes such as `<img onerror=…>` never run, so the usual way to turn HTML injected through an
email into script is disarmed even if it got past the sanitizer. Attachments are served with their
own, stricter policy (`default-src 'none'; sandbox`).

## Calls to outside services

Calls to services Mailclaw does not run (Cloudflare API, AWS, Resend, Apple and Web Push) have a
deadline, so a service that accepts the connection and never answers cannot hold a request or a
queue job until the platform kills it: 30 seconds for API calls, 60 seconds for sending a message,
120 seconds for moving a raw message to or from storage, 10 seconds for a push notification.
Request bodies from outside are capped as well: 1 MiB for Resend and SES notifications, 25 MiB for
the self-hosted relay endpoint (`413` beyond it) and 10 MiB for JMAP uploads.

## Deleted attachments stay in the original message

Deleting an attachment removes its stored file and its row, so it can no longer be
downloaded, previewed or shared. The message's original MIME (`rawR2Key`) is a faithful
copy of what arrived and is not rewritten, so **Download original** and the JMAP raw
blob still contain the attachment bytes. Delete the whole message to remove the original.

Public shared-file links stop working as soon as the message is moved to trash or spam
or its mailbox is disabled; they also expire on their own.

## Authentication results

* Cloudflare receiving: SPF, DKIM and DMARC come from the `Authentication-Results`
  header Cloudflare writes (authserv-id `mx.cloudflare.net`). A failure in any such clause
  wins over a pass.
* SES and Resend receiving: the provider's own verdicts are used.
* Self-hosted SMTP: the listener verifies SPF, DKIM and DMARC itself (with `mailauth`,
  using the connecting IP and the envelope sender) and feeds the results to the same
  policy. If DNS cannot answer within 10 seconds the mail carries no authentication
  signal and is delivered as before.

Sender-written `Authentication-Results`, `Received-SPF` and `Received` headers are never
trusted on the SMTP path. The listener also refuses recipients on domains Mailclaw does not
manage before accepting DATA.

## Webhooks

Webhook URLs must be `https://` on a public host. Redirects are not followed, and hooks
saved before this rule are re-checked at delivery. Mail filed as spam or trash does not
trigger `message.inbound`.

Deliveries are recorded first and then posted from the outbound queue, the first attempt
included, so a slow endpoint never delays receiving or sending mail. If the queue cannot take
them, they are posted straight away instead. A delivery that already succeeded, or ran out of
attempts, is not posted again when the queue redelivers its message; only the manual retry on the
deliveries page sends it again.

## Forwarding loop guard

Mail Mailclaw forwards carries `X-Mailclaw-Forwarded`, an HMAC keyed with a server secret
(`CF_TOKEN`, `CF_API_KEY` or `INBOUND_WEBHOOK_SECRET`). A sender cannot switch forwarding
off by adding the header. With none of those set the header falls back to `1`.

## Attachments

Mailclaw does not run an antivirus engine. What it does instead:

* SES, and Resend (which receives through SES), drop mail the provider flagged as infected.
* Every attachment is judged from its name and type: programs and scripts, macro-enabled
  Office files, double extensions such as `invoice.pdf.exe`, hidden bidi characters, and
  containers that hide other files (HTML, SVG, disk images, archives).
* ZIP files are inspected without extracting anything: the file names in the central
  directory are read with two bounded range requests (at most 1000 entries and 1 MiB of
  directory). Password-protected or unreadable archives are flagged.
* A flagged attachment shows the reasons in the viewer, and the download stays disabled
  until the user ticks "I understand the risk". The server refuses an unacknowledged
  download of a flagged file with HTTP 409, so a direct link cannot bypass it.

This stops one-click downloads of things that are dangerous by design. It does not find
malware in an ordinary-looking PDF or image; put ClamAV or a provider scan in front of the
server if you need that.
