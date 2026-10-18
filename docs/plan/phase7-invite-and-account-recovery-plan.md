# Phase 7 — Email invitations, password recovery and admin safety

Branch: `30-invite-link-for-new-users` (up to date with `main` at `e0aba0d`, which
includes the merged `27-logging-issue` work).

Status: **Approved 2026-10-18 with the decisions in §9 — being implemented.**

---

## 1. Goal

The approval hub handles the college's money, so every account must belong to a
real, verified person, and nobody — including an administrator — may be able to
take over someone else's account.

1. **Invite, don't create passwords.** The administrator enters a person's email,
   employee details and role(s). The system emails them a one-time invitation:
   *"You have been invited to the S.P. College Approval Hub as CDC Grant Member."*
2. **The invitee proves their email and sets their own password.** Clicking the
   link proves they control that mailbox. Only they ever know the password.
3. **Forgotten passwords are reset by email, securely.** No administrator involved.
4. **An administrator can never be permanently locked out**, and can never misuse
   the platform to act as another user.
5. **Nothing hard-coded.** Policies (expiry times, password rules, allowed email
   domains, …) are configuration; secrets live only in the hosting environment.

## 2. What `main` already has (keep it)

| Already in place | Where |
|---|---|
| One-time setup tokens: 32 random bytes, only the SHA-256 hash is stored, 24 h expiry, single use, consumed atomically | `account_setup_tokens`, `fn_consume_account_setup_token`, `routes/auth.js` |
| Invited accounts start inactive with an unusable password | `routes/admin.js` `POST /users` |
| All sessions revoked when a password is set or changed (`token_version`) | `auth.js`, `routes/auth.js` |
| Sign-in rate limits; same timing for unknown email vs wrong password | `routes/auth.js` |
| Self-service password change (needs the current password) | `POST /api/auth/change-password` |
| Email sending via Brevo → Resend → SMTP | `mailer.js` |
| Secrets refused by the database config store; kept in environment variables | `configService.js` |
| Cannot deactivate or demote the last active administrator | `routes/admin.js` |
| Dev "quick fill" logins only in development builds | `src/pages/Login.jsx` |

## 3. Gaps found (why this phase is needed)

| # | Gap | Risk |
|---|---|---|
| G1 | `POST /api/admin/users` and `/users/:id/setup-token` **return the raw setup link to the admin** (`setupToken`, `setupUrl`) | Admin can open it and set the invitee's password — the exact misuse to prevent |
| G2 | `PATCH /api/admin/users/:id` accepts **`password`** and writes it | Admin can set any user's password and sign in as them |
| G3 | Admin can **change any user's email** directly | With a reset-by-email feature, admin could point someone's account at their own mailbox and take it over |
| G4 | Invitation links are **never emailed** (`emailDelivery: 'UNCONFIGURED'`) | Links are passed around by hand (WhatsApp etc.) |
| G5 | **No forgot-password** — the login page says "ask the administrator" | Forces admin involvement; tempts admins to set passwords |
| G6 | **No admin recovery path**; production has no seed accounts | If every admin forgets their password, nobody can manage users |
| G7 | Public **self-registration** endpoint exists (off by default, flag-controlled) | Unverified accounts on a finance system |
| G8 | Sign-in rate limits are **in memory** on Render | Reset on every restart / free-tier sleep; not a real lockout |
| G9 | Link token travels in the **URL query string** (`?token=`) | Can land in server logs, proxies, browser history |
| G10 | Password rule is **8 characters**, repeated in 4 places; bcrypt cost `12` in 5 places | Weak for finance; inconsistent if one copy changes |
| G11 | `APP_URL` silently defaults to `http://localhost:3000` | Production emails would link to localhost |
| G12 | Role→stage mapping hard-coded in `POST /users` (and still says `VICE_PRESIDENT`) | Drifts from the rest of the system |
| G13 | Login token kept in `localStorage` | Readable by any script injected into the page (XSS) |

## 4. The new flows

### 4.1 Invitation (admin → employee)

```
Admin: User Management → "Invite user"
  email*, full name*, employee ID, department, role(s)*, CDC classification
        │  (email must be on the allowed college domains — configurable)
        ▼
API: create user (status INVITED, no password)  +  INVITE token (hash only)
     email the link to that address.  Admin sees only:
     "Invitation sent to p.shinde@spcollege.edu — expires 20 Oct, 10:00"
        ▼
Employee opens the email → https://<app>/#/accept-invite/<token>
     page shows: name, email, "invited as CDC Grant Member (Teaching)", who invited
     sets password (policy shown live) → account ACTIVE, signed in
        ▼
Emails: invitee "Welcome — your account is active";
        admin "p.shinde accepted the invitation"
```

- The admin **never sees the token or link** (fixes G1). Admin actions: **Resend**
  (new token, old one dies) and **Revoke** (cancels a pending invitation).
- If sending fails, the admin sees "Could not send — check email settings", not
  the link. Delivery failures are logged without the token.
- User list shows status: **Invited** (sent / expires), **Expired**, **Active**,
  **Deactivated**.

### 4.2 Forgot password (anyone, including admins)

```
Login → "Forgot password?" → enter email
API: ALWAYS answers "If an account exists for that address, we've emailed a link"
     (same response and timing either way — no account discovery)
     only for ACTIVE accounts: create RESET token (short expiry), email the link
        ▼
User opens link → sets a new password
API: consume token atomically → new hash → token_version+1 (every session signed out)
     → clear lockout → email "Your password was changed. Not you? contact …"
```

- Requests rate-limited per email and per IP; a new request cancels the previous link.
- No security questions, no SMS, no admin step.

### 4.3 Admin can never be locked out — and can't misuse the system

1. **Admins reset their own password the same way** (4.2). Most "forgot password"
   cases end there.
2. **One administrator, protected by 2-step verification** (authenticator app).
   At setup the admin receives one-time **recovery codes** to keep safely; one code
   signs them in if the phone is lost. The existing "last active administrator"
   guard stays.
3. **Break-glass recovery from the server**, for when no admin can sign in:
   `node scripts/admin-recovery.js --email principal.admin@spcollege.edu`
   Run only by whoever administers the college server / cPanel (today: whoever
   holds the Render/Neon credentials). It works only for an existing administrator
   account, **emails** that admin a reset link and can clear their 2-step
   verification so they can enrol again. It never prints a password and is
   recorded in the audit log as a system recovery.
   The same script bootstraps the very first administrator on a fresh production
   database, since production must never load the dev seed.
4. **Admins lose the takeover tools:** no setting passwords (G2), no seeing links
   (G1), and **email changes need confirmation from the new address** while the old
   address is notified (G3). Every admin action on accounts stays in the audit log.

## 5. "Encrypted and automated" — what that means concretely

| Item | How it's protected |
|---|---|
| Passwords | **bcrypt** (one-way). Nobody — admin, developer, database — can ever read them. "Encrypted" passwords that can be decrypted would be *less* safe, so we hash. |
| Invite / reset / email-change links | 32 random bytes; only the **SHA-256 hash** is stored; single use; short expiry; bound to the email they were sent to; cancelled when a newer one is issued. |
| Secrets (JWT, signing key, email API key) | Only in Render/Vercel environment variables. Never in code, git or the database (already enforced). Server refuses to start if a required secret is missing or weak. |
| Data in transit | HTTPS everywhere (HSTS already set); Neon requires TLS. |
| Data at rest | Neon encrypts storage. |
| Login session | Phase 3: move the token from `localStorage` to a `Secure; HttpOnly; SameSite` cookie (G13). |
| Policies | Configuration, edited by admins, with audit: invite expiry, reset expiry, password minimum, lockout limits, allowed email domains, minimum admins. |

## 6. Changes by layer

### 6.1 Database (one migration + schema mirror, as the repo requires)

- `account_setup_tokens` → general one-time tokens: add `purpose`
  (`INVITE` | `PASSWORD_RESET` | `EMAIL_CHANGE`), `sent_to_email`, `new_email`
  (email change), `requested_ip`, `revoked_at`. Existing rows become `INVITE`.
  One live token per user per purpose.
- Generalize `fn_verify_…` / `fn_consume_…` to take a purpose. Consuming:
  - an invite activates the account;
  - a reset sets the password and clears the lockout;
  - an email change swaps the email.
  All three bump `token_version`.
- `users`: add `invited_by`, `invited_at`, `activated_at`, `password_changed_at`,
  `failed_login_count`, `locked_until` (database-backed lockout — G8).
- New config keys (non-secret, defaults in `configService`): `auth.invite_ttl_hours`
  (168 = 7 days), `auth.reset_ttl_minutes` (60), `auth.password_min_length` (12),
  `auth.lockout_threshold` (5), `auth.lockout_minutes` (15),
  `auth.allowed_email_domains` (empty = every domain allowed).
- 2-step verification: `users.mfa_secret_enc` (TOTP secret, **AES-256-GCM encrypted**
  with `MFA_ENCRYPTION_KEY` from the environment), `users.mfa_enabled_at`, and a
  `mfa_recovery_codes` table holding only hashes of one-time recovery codes.
- Register the migration in `17_schema_migrations.sql`; add it to the Neon
  checklist in `docs/DEPLOY_DB_NEON.md`.

### 6.2 API

| Endpoint | Change |
|---|---|
| `POST /api/admin/users` | Becomes **invite**: validates domain, creates INVITED user + roles + stage staffing (from the shared role→stage rule, G12), emails the link. **Response never contains the token.** |
| `POST /api/admin/users/:id/invite` | Resend (replaces `/setup-token`; no link in response) |
| `DELETE /api/admin/users/:id/invite` | Revoke a pending invitation |
| `PATCH /api/admin/users/:id` | **Remove `password`**. `email` → starts an EMAIL_CHANGE confirmation instead of overwriting |
| `GET /api/auth/invite/:token`, `POST /api/auth/accept-invite` | Replace `verify-setup-token` / `setup-account`; token sent in the body, not the query string (G9) |
| `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` | New (4.2) |
| `POST /api/auth/confirm-email-change` | New |
| `POST /api/auth/login` | Adds database-backed lockout; keeps current timing protection |
| `POST /api/auth/register` | **Removed** (invite-only) — or kept behind the flag, see §9 |
| Startup | Fail if `APP_URL` is missing or not `https://` in production (G11); one password-policy module and one bcrypt-cost setting used everywhere (G10) |

Emails (new templates in `emailTemplates.js`):
- invitation;
- welcome / invitation accepted;
- reset link;
- password changed;
- email-change confirmation (to the new address) and notice (to the old address);
- account deactivated.

### 6.3 Frontend

- **User Management:** "Invite user" form, status chips, Resend / Revoke buttons.
  The setup-link display is removed.
- **Accept-invite page:** replaces `SetupAccount.jsx`. Shows the invited role and
  has a live password-strength checklist.
- **Forgot-password and reset-password pages**, plus a "Forgot password?" link on
  Login. The "ask the administrator" text goes.
- **Settings → Security policy** (admin): edit the auth config keys above.
- Links use the hash route (`#/accept-invite/<token>`) so the token never reaches
  the server's request logs.

### 6.4 Scripts and docs

- `server/scripts/admin-recovery.js`: bootstrap the first admin and break-glass
  reset (4.3).
- `docs/DEPLOY_DB_NEON.md`: the new migration, plus the environment variables
  `APP_URL` and the email provider.
- `docs/ADMIN_RECOVERY.md`: who holds break-glass access and how to use it.

## 7. Tests (each phase ships with them)

1. Invite: the email is sent; the API response contains no token; the link works
   once; expired, revoked or reused links are refused.
2. The invitee sets the password; the admin cannot (`PATCH` with `password` → 422).
3. Forgot password: same response for known, unknown and inactive emails; link
   works once; all old sessions die; "password changed" email sent.
4. Email change: needs confirmation from the new address; the old address is
   notified; until confirmed, a reset link still goes to the old address.
5. Lockout after N failures survives an API restart; a successful reset clears it.
6. Can't drop below the minimum number of admins; break-glass script works only
   for admin accounts.
7. Domain allow-list enforced; the server refuses to start without an `https`
   `APP_URL` in production.
8. No token ever appears in API responses, audit logs or server logs (grep-based
   test, like the existing `dist/` secrets test).
9. Existing suite and RLS checks stay green; migration verified against a copy of
   `main` (same method used for the CDC fix).

## 8. Delivery plan (small commits, each reviewable)

| Phase | Contents | Risk to current users |
|---|---|---|
| **1. Close the takeover holes** | Remove `password` from admin `PATCH`; stop returning links to admin; email the invite instead; require `APP_URL`; one password policy (min 12) and one bcrypt setting | None for active users; pending invites must be resent once |
| **2. Proper invitations** | Token purposes, invite page with role shown, resend/revoke, status chips, domain allow-list, welcome/accepted emails | None |
| **3. Forgot password + lockout** | Forgot/reset flow, database-backed lockout, "password changed" emails | None |
| **4. Email change + admin safety** | Confirmed email change, minimum-admins rule, break-glass/bootstrap script + doc | None |
| **5. Admin 2-step verification** | TOTP enrolment for the administrator (required), recovery codes, sign-in second step, break-glass reset of 2-step | Admin enrols once |
| 6. Session hardening (later) | HttpOnly cookie instead of `localStorage` | Everyone signs in again once |

Each phase: migration (if any) → run on Neon via the checklist → deploy backend →
deploy frontend.

## 9. Decisions (agreed 2026-10-18)

1. **Email domains:** any domain — college, Gmail, Outlook. The allow-list exists as a
   setting but is empty by default.
2. **Expiry:** generous, because not everyone is tech-savvy — invitations **7 days**,
   reset links **60 minutes**. Both are settings.
3. **Self-registration:** removed. Invite-only.
4. **Email delivery:** nothing hard-coded. Testing runs on Render; production will be the
   college's cPanel server (likely its SMTP). Provider, sender address and the app's
   public address all come from configuration.
5. **Break-glass holder:** whoever administers the college server / cPanel.
6. **2-step verification:** now, for the administrator (required).
7. **Administrators:** exactly one is expected; protected by 2-step verification,
   recovery codes and the break-glass script.
