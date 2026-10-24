import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} — see .env.example`);
  }
  return value;
}

function secret(name) {
  const value = required(name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

// Where people open the app: the base of every link in an email (requests,
// invitations, password resets). In production it must be set and must be https — a link
// to localhost or plain http would be useless or unsafe. Outside production a
// local default keeps development simple. null means "not usable": features
// that email links refuse to run rather than send a broken one.
export function resolveAppUrl(env = process.env) {
  const isProd = env.NODE_ENV === 'production';
  const raw = (env.FRONTEND_URL ?? env.APP_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    if (isProd) {
      console.error('[config] FRONTEND_URL / APP_URL is not set: emailed links are disabled in production until configured.');
      return null;
    }
    return 'http://localhost:3000';
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error(`[config] APP_URL / FRONTEND_URL "${raw}" is not a valid URL: emailed links are disabled.`);
    return null;
  }
  if (isProd) {
    if (url.protocol !== 'https:') {
      console.error('[config] APP_URL / FRONTEND_URL must use https in production: emailed links are disabled.');
      return null;
    }
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      console.error('[config] APP_URL / FRONTEND_URL cannot be localhost in production: emailed links are disabled.');
      return null;
    }
  }
  return raw;
}

function bcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  if (!Number.isInteger(rounds) || rounds < 10 || rounds > 15) {
    throw new Error('BCRYPT_ROUNDS must be a whole number from 10 to 15');
  }
  return rounds;
}

// "outbox" writes each email to a file instead of sending it — for local
// development and the test suite only; refused in production.
function mailTransport() {
  const value = (process.env.MAIL_TRANSPORT ?? 'auto').trim().toLowerCase();
  if (!['auto', 'outbox'].includes(value)) throw new Error('MAIL_TRANSPORT must be "auto" or "outbox"');
  if (value === 'outbox' && isProduction) throw new Error('MAIL_TRANSPORT=outbox is not allowed in production');
  return value;
}

// Encrypts authenticator secrets and keys recovery-code hashes: 32 bytes,
// given as 64 hex characters or base64. Generate one with
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Required in production. Elsewhere a random key is made per start, with a
// warning — fine for development, but 2-step enrolments then do not survive a
// restart. Never hard-coded, never stored in the database.
function mfaKey() {
  const raw = (process.env.MFA_ENCRYPTION_KEY ?? '').trim();
  if (!raw) {
    if (isProduction) {
      console.error('[config] MFA_ENCRYPTION_KEY is not set: 2-step verification is unavailable.');
      return null;
    }
    console.warn('[config] MFA_ENCRYPTION_KEY not set; using a temporary key for this run (development only).');
    return crypto.randomBytes(32);
  }
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  return buf;
}

// The time zone dates in emails are written in.
function timeZone() {
  const zone = (process.env.APP_TIMEZONE ?? 'Asia/Kolkata').trim();
  try { new Intl.DateTimeFormat('en-IN', { timeZone: zone }); } catch {
    throw new Error(`APP_TIMEZONE "${zone}" is not a recognised time zone`);
  }
  return zone;
}

export const config = Object.freeze({
  isProduction,
  get appUrl() {
    return resolveAppUrl();
  },
  get frontendUrl() {
    return resolveAppUrl();
  },
  timeZone: timeZone(),
  mfaKey: mfaKey(),
  bcryptRounds: bcryptRounds(),
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: secret('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Separate from the JWT secret: rotating session keys must not make every
  // recorded approval seal unverifiable.
  signingSecret: secret('SIGNING_SECRET'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,

  // Google Drive storage backend.
  // When both are set, uploads go to Drive instead of the local disk.
  // GDRIVE_CREDENTIALS = base64-encoded service account JSON key file.
  // GDRIVE_FOLDER_ID   = ID of the Drive folder shared with the service account.
  // See docs/GOOGLE_DRIVE_SETUP.md for how to generate these.
  gDriveCredentials: (process.env.GDRIVE_CREDENTIALS ?? '').trim() || null,
  gDriveFolderId:    (process.env.GDRIVE_FOLDER_ID    ?? '').trim() || null,

  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  mail: Object.freeze({
    transport: mailTransport(),
    outboxDir: path.resolve(process.env.MAIL_OUTBOX_DIR ?? 'mail-outbox'),
    // The sender name people see; the address comes from the provider settings.
    fromName: (process.env.MAIL_FROM_NAME ?? '').trim() || null,
  }),

  // SMTP (e.g. the college server's cPanel mail). No default host: the server
  // it sends through must be chosen explicitly.
  smtp: Object.freeze({
    host: (process.env.SMTP_HOST ?? '').trim(),
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? 'true').trim() === 'true',
    user: (process.env.SMTP_USER ?? '').trim(),
    pass: (process.env.SMTP_PASS ?? '').trim(),
    from: (process.env.SMTP_FROM ?? (process.env.SMTP_USER ? `"SP College Workflow" <${process.env.SMTP_USER}>` : '')).trim(),
  }),
  // Resend HTTP API (for cloud hosts that block SMTP ports)
  resendApiKey: (process.env.RESEND_API_KEY ?? '').trim(),
  resendFrom: (process.env.RESEND_FROM ?? '').trim(),
  // Brevo HTTP API (alternative for cloud hosts without domain verification)
  brevoApiKey: (process.env.BREVO_API_KEY ?? '').trim(),
  brevoSenderEmail: (process.env.BREVO_SENDER_EMAIL ?? '').trim(),
  // Principal email override for notifications (optional; defaults to resolving active Principal from DB)
  principalEmail: (process.env.PRINCIPAL_EMAIL ?? '').trim() || null,
});
