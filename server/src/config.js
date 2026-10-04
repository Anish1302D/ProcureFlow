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

export const config = Object.freeze({
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

  // SMTP email configuration (local dev fallback)
  smtp: Object.freeze({
    host: (process.env.SMTP_HOST ?? 'smtp.gmail.com').trim(),
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: (process.env.SMTP_SECURE ?? 'true').trim() === 'true',
    user: (process.env.SMTP_USER ?? '').trim(),
    pass: (process.env.SMTP_PASS ?? '').trim(),
    from: (process.env.SMTP_FROM ?? `"SP College Workflow" <${process.env.SMTP_USER ?? 'noreply@spcollege.edu.in'}>`).trim(),
  }),
  // Resend HTTP API (for cloud hosts that block SMTP ports)
  resendApiKey: (process.env.RESEND_API_KEY ?? '').trim(),
  resendFrom: (process.env.RESEND_FROM ?? 'SP College Workflow <onboarding@resend.dev>').trim(),
  // Brevo HTTP API (alternative for cloud hosts without domain verification)
  brevoApiKey: (process.env.BREVO_API_KEY ?? '').trim(),
  brevoSenderEmail: (process.env.BREVO_SENDER_EMAIL ?? '').trim(),
  // Default principal email for issue notifications (demo)
  principalEmail: (process.env.PRINCIPAL_EMAIL ?? 'protonedge01@gmail.com').trim(),
});
