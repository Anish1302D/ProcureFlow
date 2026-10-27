# Making "Forgot password?" emails work on Render

**For:** whoever manages the Render backend (`sp-college-approval-hub.onrender.com`)
and the Vercel frontend.
**Problem:** someone asks for a password reset and the email never arrives.

The code works from start to finish. The automated suite requests a reset,
receives the email, opens its link, sets a new password and signs in. When no
email reaches a real inbox, the cause is almost always one of the Render
settings below. **The sign-in page always shows "a link is on its way",
whether or not an email was sent.** It does this on purpose, so nobody can use
the page to find out which addresses have accounts. The only place that shows
what actually happened is the **Render logs**.

---

## 1. Environment variables to set on Render

Go to Render, open the API service, then **Environment**. After saving, run
**Manual Deploy → Deploy latest commit** (Render only picks up changed
variables after a redeploy).

### Required for any emailed link

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | Turns on the production safety checks. |
| `APP_URL` | The frontend address people open, e.g. `https://<your-project>.vercel.app`: **https, no trailing slash, no path** | Every reset, invite and email-confirmation link starts with this. **If it is missing or not https, no reset email is sent at all.** The page still says "on its way". |
| `MAIL_TRANSPORT` | `auto`, or leave it unset | `outbox` is refused in production. |
| `MAIL_FROM_NAME` | e.g. `SP College Approval Hub` (optional) | The sender name people see. |

### Email provider: pick ONE

**Render's free instances block outgoing SMTP** (ports 25, 465 and 587). Gmail
or cPanel SMTP settings will time out there. Use an HTTPS email API instead.

**Option A: Brevo (recommended; no domain needed to start)**

| Variable | Value |
|---|---|
| `BREVO_API_KEY` | From Brevo: **SMTP & API → API keys → Generate** (starts with `xkeysib-`) |
| `BREVO_SENDER_EMAIL` | An address added and **verified** in Brevo under **Senders, Domains & Dedicated IPs → Senders**. Brevo refuses to send from an unverified sender. |

**Option B: Resend**

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | From resend.com → API Keys |
| `RESEND_FROM` | An address on a domain **verified** at resend.com/domains, e.g. `noreply@spcollege.edu.in` |

> With Resend's test sender `onboarding@resend.dev`, mail goes **only to the
> Resend account owner's own address**. Everyone else silently gets nothing.
> A verified domain is required for real users.

**Option C: SMTP.** Only on a paid Render instance, or on the college's own
server. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`
and `SMTP_FROM`. For Gmail, `SMTP_PASS` must be an App Password, not the
account password.

If more than one provider is set, the order tried is Brevo, then Resend, then
SMTP. Each one falls back to the next.

### Already required (listed here for completeness)

`DATABASE_URL`, `JWT_SECRET`, `SIGNING_SECRET` and `MFA_ENCRYPTION_KEY`. See
`server/.env.example` and `docs/DEPLOY_DB_NEON.md`.

---

## 2. Database: migrations must be applied

Password resets use tables and functions added by migrations. On the Neon
production database, apply everything in `db/migrations/` that is not applied
yet, in filename order. The ones this feature needs are:

- `20261011T120000_add_user_token_version.sql`
- `20261018T120000_invitations_and_password_recovery.sql`

If they are missing, the reset request fails with a server error instead of
sending mail. See `docs/DEPLOY_DB_NEON.md` for how to run migrations.

---

## 3. Who can receive a reset email

A reset email is sent only when **all** of these are true:

1. The address typed matches an account's email exactly (capital letters
   don't matter).
2. That account is **active**. An invited person who never set their password
   is not active yet. Resend their **invitation** from User Management instead.
3. The account has had **fewer than 3 reset emails in the last hour**. More
   requests are silently ignored. Admins can change this limit in Settings
   (`auth.reset_requests_per_hour`).
4. The email address is a **real mailbox**. The demo accounts
   (`…@spcollege.edu`) are not real inboxes. To test, give a test account your
   own address in User Management first.

The link lasts 60 minutes (`auth.reset_ttl_minutes`). Asking again cancels the
previous link.

---

## 4. How to check it is working

1. Set the variables above and redeploy.
2. In **Render → Logs**, right after the deploy, look for:
   - `[config] APP_URL is not set…` or `…must use https…` means fix `APP_URL`.
3. On the live site, click **Forgot password?** and enter a real, active
   account's address.
4. Within a few seconds Render's logs show **one** of these:

| Log line | Meaning | Fix |
|---|---|---|
| `[mailer/brevo] sent "…" → name@…` (or `/resend`, `/smtp`) | Sent. | Check the inbox and the **spam** folder. |
| `[auth] password reset requested but APP_URL is not configured` | Nothing sent. | Set `APP_URL` (https). |
| `[mailer] Brevo failed: Brevo HTTP error 401` | Wrong API key. | Regenerate the key in Brevo. |
| `[mailer] Brevo failed: … sender … not valid` | Sender not verified. | Verify `BREVO_SENDER_EMAIL` in Brevo. |
| `Resend error: You can only send testing emails…` | Using `onboarding@resend.dev`. | Verify a domain, or use Brevo. |
| `Missing sender configuration: set RESEND_FROM` | `RESEND_FROM` empty. | Set it. |
| `SMTP failed: … ETIMEDOUT` / `Connection timeout` | Render is blocking SMTP. | Use Brevo or Resend. |
| *(no mailer line at all)* | No matching active account, or the 3-per-hour cap was hit. | See section 3. |

5. Open the emailed link. It should land on `APP_URL/#/reset-password/…`.
   Choose a new password and sign in with it.

---

## 5. Known limitation: rate limits behind Render's proxy

The API trusts forwarded client addresses only from `loopback`
(`server/src/app.js`), which suits running behind nginx or IIS on the college
server. On Render, requests arrive through Render's proxy (and through
Vercel's `/api` rewrite first). So the API may see the **proxy's** address
instead of each user's, and **everyone shares one rate-limit bucket**: 10
forgot-password requests per 15 minutes for the whole college. A busy morning
could then show "Too many requests from this network". This shows up as an
error message, never as a silently missing email. If it happens, raise it with
the developers so the trusted-proxy setting can be made configurable for
Render.
