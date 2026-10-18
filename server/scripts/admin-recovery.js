#!/usr/bin/env node
// Break-glass recovery for the administrator, and first-administrator setup.
//
// Run ON THE SERVER, by whoever administers it (the college's cPanel/server
// operator), with the same environment the API uses (server/.env or the host's
// environment variables). It is deliberately not a web endpoint: using it
// requires access to the server itself.
//
//   Recover the administrator (forgotten password and/or lost authenticator):
//     node scripts/admin-recovery.js --email admin@college.edu
//
//   Create the very first administrator on a fresh database:
//     node scripts/admin-recovery.js --bootstrap --email admin@college.edu --name "Full Name"
//
//   If the server cannot send email at all, add --print-link to show the link
//   in this terminal instead. Treat it like a password: anyone with it can use it.
//
// Recovery works only for an existing, active administrator account. It emails
// them a password reset link, lifts any sign-in pause and clears their 2-step
// verification so they can enrol again. It never sets or shows a password,
// and every run is recorded in the audit log.

import os from 'node:os';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    bootstrap: { type: 'boolean', default: false },
    'print-link': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error([
    'Usage:',
    '  node scripts/admin-recovery.js --email <admin email> [--print-link]',
    '  node scripts/admin-recovery.js --bootstrap --email <email> --name "<full name>" [--print-link]',
  ].join('\n'));
  process.exit(message ? 1 : 0);
}

if (args.help) usage();
const email = String(args.email ?? '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage('Give the administrator\'s email address with --email.');
if (args.bootstrap && !String(args.name ?? '').trim()) usage('--bootstrap needs the person\'s full name with --name.');

// Imported after argument checks: config.js validates the environment on import.
const { config } = await import('../src/config.js');
const { configService } = await import('../src/configService.js');
const { anonQuery, pool, withUser } = await import('../src/db.js');
const { accountLink, sendInvitation, sendPasswordReset } = await import('../src/accountEmails.js');
const { hashToken, newToken } = await import('../src/oneTimeLinks.js');

const operator = `${os.userInfo().username}@${os.hostname()}`;
const UNSET_PASSWORD_PREFIX = '$2a$12$unusable.placeholder';

async function deliver(kind, send, linkPath, token) {
  try {
    if (!config.appUrl) throw new Error('APP_URL is not configured');
    await send();
    console.log(`\n✔ ${kind} emailed to ${email}. The link works once.`);
  } catch (err) {
    console.error(`\n✖ Could not email the ${kind.toLowerCase()}: ${err.message}`);
    if (!args['print-link']) {
      console.error('  Fix the email settings and run again, or add --print-link to show the link here.');
      process.exitCode = 2;
      return;
    }
  }
  if (args['print-link']) {
    if (!config.appUrl) {
      console.error('  APP_URL is not set, so no usable link can be shown. Set APP_URL first.');
      process.exitCode = 2;
      return;
    }
    console.log(`\n  ${kind} link (treat it like a password, give it only to ${email}):\n  ${accountLink(linkPath, token)}\n`);
  }
}

try {
  const { rows: admins } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.is_active
       FROM users u JOIN user_roles ur ON ur.user_id = u.user_id JOIN roles r ON r.role_id = ur.role_id
      WHERE r.code = 'ADMIN'`,
  );

  if (args.bootstrap) {
    if (admins.some((a) => a.is_active)) {
      usage('An active administrator already exists. Bootstrap only creates the first one; use recovery (without --bootstrap) instead.');
    }
    const { rows: taken } = await anonQuery('SELECT 1 FROM users WHERE email = $1', [email]);
    if (taken.length) usage(`An account already uses ${email}.`);

    const { rows: [role] } = await anonQuery("SELECT role_id, name FROM roles WHERE code = 'ADMIN'");
    const placeholder = `${UNSET_PASSWORD_PREFIX}.setup.required.${newToken().slice(0, 32)}`;
    const { rows: [created] } = await anonQuery(
      `INSERT INTO users (email, full_name, password_hash, is_active, token_version, invited_at)
       VALUES ($1, $2, $3, FALSE, 1, NOW()) RETURNING user_id`,
      [email, args.name.trim(), placeholder],
    );
    await anonQuery('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [created.user_id, role.role_id]);

    // The token table is administrator-only under row-level security; acting
    // as the new administrator lets this run with the API's own database role.
    const token = newToken();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (await configService.get('auth.invite_ttl_hours')) * 3_600_000);
    await withUser(created.user_id, async (db) => {
      await db.query(
        `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, purpose, sent_to_email, requested_ip)
         VALUES ($1, $2, $3, 'INVITE', $4, 'server-console')`,
        [created.user_id, hashToken(token), expiresAt, email],
      );
      await db.query(
        `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
         VALUES ('user', $1::text, NULL, 'ADMIN_BOOTSTRAPPED', jsonb_build_object('operator', $2::text))`,
        [created.user_id, operator],
      );
    });
    console.log(`Created the administrator account for ${email}.`);
    await deliver('Invitation', () => sendInvitation({
      to: email, fullName: args.name.trim(), roleNames: [role.name], token, issuedAt, expiresAt,
    }), 'accept-invite', token);
  } else {
    const admin = admins.find((a) => String(a.email).toLowerCase() === email);
    if (!admin) usage(`${email} is not an administrator. Recovery is only for the administrator account.`);
    if (!admin.is_active) usage(`${email} is deactivated. Reactivate it from another administrator account, or use --bootstrap on a database with no active administrator.`);

    const token = newToken();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + (await configService.get('auth.reset_ttl_minutes')) * 60_000);
    await withUser(admin.user_id, async (db) => {
      await db.query(
        `UPDATE account_setup_tokens SET revoked_at = NOW()
          WHERE user_id = $1 AND purpose = 'PASSWORD_RESET' AND used_at IS NULL AND revoked_at IS NULL`,
        [admin.user_id],
      );
      await db.query(
        `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, purpose, sent_to_email, requested_ip)
         VALUES ($1, $2, $3, 'PASSWORD_RESET', $4, 'server-console')`,
        [admin.user_id, hashToken(token), expiresAt, admin.email],
      );
      // Lift any sign-in pause and clear 2-step verification so they can enrol again.
      await db.query(
        `UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = NOW() WHERE user_id = $1`,
        [admin.user_id],
      );
      const { rows: mfaCols } = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'mfa_secret_enc'`,
      );
      if (mfaCols.length) {
        await db.query(
          `UPDATE users SET mfa_secret_enc = NULL, mfa_pending_secret_enc = NULL, mfa_enabled_at = NULL,
                  mfa_last_step = NULL, token_version = COALESCE(token_version, 1) + 1 WHERE user_id = $1`,
          [admin.user_id],
        );
        await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [admin.user_id]);
      }
      await db.query(
        `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
         VALUES ('user', $1::text, NULL, 'BREAK_GLASS_RECOVERY', jsonb_build_object('operator', $2::text))`,
        [admin.user_id, operator],
      );
    });
    console.log(`Recovery prepared for ${admin.email}: sign-in pause lifted, 2-step verification cleared.`);
    await deliver('Password reset link', () => sendPasswordReset({
      to: admin.email, fullName: admin.full_name, token, issuedAt, expiresAt,
    }), 'reset-password', token);
  }
} finally {
  await pool.end();
}
