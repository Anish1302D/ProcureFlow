# Administrator recovery and first-time setup

The approval hub has **one administrator**. Nobody — not the administrator,
not a developer — can see or set another person's password, so recovering the
administrator account is done from the **server itself**, by whoever runs it.

**Who may do this:** the person who administers the college server / cPanel
(during testing: whoever has the Render and Neon access). Keep this list short.

## When the administrator forgets their password

Try the normal way first: **Forgot password?** on the sign-in page emails a
reset link. Only use the steps below if that is not possible — for example the
administrator also lost their authenticator phone and recovery codes.

## Recover the administrator

On the server, in the `server/` folder, with the same environment the API uses:

```bash
node scripts/admin-recovery.js --email admin@your-college.edu
```

What it does:

1. Checks the address belongs to the **active administrator** (it refuses anyone else).
2. Emails them a **password reset link** (valid for the configured time, one use).
3. Lifts any sign-in pause and **clears their 2-step verification**, so they
   enrol a new authenticator at their next sign-in.
4. Records the run in the audit log (`BREAK_GLASS_RECOVERY`, with the server
   user and host name).

It never sets, prints or emails a password.

If the server cannot send email at all, add `--print-link`; the link is shown
in the terminal instead. **Treat it like a password**: give it only to the
administrator, in person or by phone, and never paste it into chat or email.

## Create the first administrator (new installation)

A fresh production database has no accounts (the development seed must never
be loaded on the college server). Create the administrator with:

```bash
node scripts/admin-recovery.js --bootstrap --email admin@your-college.edu --name "Full Name"
```

This emails them an invitation to set their own password. It refuses to run if
an active administrator already exists, so it cannot be used to add a second,
hidden administrator.

## Requirements on the server

The script uses the API's environment: `DATABASE_URL`, `APP_URL` (the https
address people open the app at), the email provider settings, and — once 2-step
verification is enabled — `MFA_ENCRYPTION_KEY`. If an emailed link would not
work (for example `APP_URL` is missing), the script says so and stops.
