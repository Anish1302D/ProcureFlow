import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { config } from './config.js';
import { configService } from './configService.js';

// The name recipients see as the sender: MAIL_FROM_NAME, else the institution
// name from configuration. Never a name written into the code.
async function senderName() {
  if (config.mail.fromName) return config.mail.fromName;
  try { return await configService.get('institution.name'); } catch { return null; }
}

// Development and test transport: each email becomes a JSON file in
// MAIL_OUTBOX_DIR instead of leaving the machine. config.js refuses it in
// production.
async function _writeToOutbox({ to, cc, subject, html }) {
  await fs.mkdir(config.mail.outboxDir, { recursive: true });
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(
    path.join(config.mail.outboxDir, `${id}.json`),
    JSON.stringify({ id, to, cc: cc ?? null, subject, html, sentAt: new Date().toISOString() }, null, 2),
  );
  return { messageId: id, response: 'outbox' };
}

// ---------------------------------------------------------------------------
// Transport: Resend (HTTP API) or SMTP (nodemailer) depending on config.
//
// Render's free tier blocks outbound SMTP ports (587, 465). Resend uses
// HTTPS, so it works everywhere.  When RESEND_API_KEY is set we use it;
// otherwise we fall back to SMTP for local development.
// ---------------------------------------------------------------------------

let resendClient = null;
let smtpTransporter = null;

function useResend() {
  return Boolean(config.resendApiKey);
}

function getResendClient() {
  if (resendClient) return resendClient;
  resendClient = new Resend(config.resendApiKey);
  return resendClient;
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 5000,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
  return smtpTransporter;
}

/**
 * Sends an email using Brevo (HTTP), Resend (HTTP), or SMTP (nodemailer).
 * If the primary transport fails and another is configured, it retries
 * with the fallback transport so at least one path can succeed.
 *
 * @param {{ to: string, cc?: string, subject: string, html: string }} opts
 */
export async function sendMail({ to, cc, subject, html }) {
  if (config.mail.transport === 'outbox') {
    return _writeToOutbox({ to, cc, subject, html });
  }

  // 1. If Brevo HTTP API is configured, use it first (HTTPS port 443, never blocked by cloud hosts)
  if (config.brevoApiKey) {
    try {
      return await _sendViaBrevo({ to, cc, subject, html });
    } catch (brevoErr) {
      console.warn(`[mailer] Brevo failed: ${brevoErr.message}`);
    }
  }

  // 2. Resend HTTP API
  if (useResend()) {
    try {
      return await _sendViaResend({ to, cc, subject, html });
    } catch (resendErr) {
      console.warn(`[mailer] Resend failed: ${resendErr.message}`);
      if (resendErr.message?.includes('testing emails')) {
        console.warn(
          `[mailer] Account restriction: Resend with onboarding@resend.dev only permits sending to the verified account owner. ` +
          `To deliver to external addresses like ${to}, verify a custom domain on resend.com/domains or provide BREVO_API_KEY.`
        );
      }
      // Fallback to SMTP if credentials are configured
      if (config.smtp.user && config.smtp.pass) {
        console.log('[mailer] Falling back to SMTP…');
        return await _sendViaSmtp({ to, cc, subject, html });
      }
      throw resendErr;
    }
  }

  // 3. Primary: SMTP
  try {
    return await _sendViaSmtp({ to, cc, subject, html });
  } catch (smtpErr) {
    console.warn(`[mailer] SMTP failed: ${smtpErr.message}`);
    // Fallback to Resend if API key is configured
    if (config.resendApiKey) {
      console.log('[mailer] Falling back to Resend…');
      return await _sendViaResend({ to, cc, subject, html });
    }
    throw smtpErr;
  }
}

async function _sendViaBrevo({ to, cc, subject, html }) {
  const senderEmail = config.brevoSenderEmail || config.smtp.user;
  if (!senderEmail) {
    throw new Error('Missing sender email configuration: set BREVO_SENDER_EMAIL or SMTP_USER in environment');
  }
  const name = await senderName();
  const toList = (Array.isArray(to) ? to : to.split(',')).map((e) => ({ email: e.trim() }));
  const ccList = cc ? (Array.isArray(cc) ? cc : cc.split(',')).map((e) => ({ email: e.trim() })) : undefined;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': config.brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: name ? { name, email: senderEmail } : { email: senderEmail },
      to: toList,
      cc: ccList,
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Brevo HTTP error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  console.log(`[mailer/brevo] sent "${subject}" → ${to} (id: ${data.messageId || 'OK'})`);
  return { messageId: data.messageId, response: 'Brevo OK' };
}

async function _sendViaResend({ to, cc, subject, html }) {
  if (!config.resendFrom) {
    throw new Error('Missing sender configuration: set RESEND_FROM (an address on a domain verified with Resend)');
  }
  const resend = getResendClient();
  const { data, error } = await resend.emails.send({
    from: config.resendFrom,
    to: Array.isArray(to) ? to : to.split(',').map((e) => e.trim()),
    cc: cc ? (Array.isArray(cc) ? cc : cc.split(',').map((e) => e.trim())) : undefined,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  console.log(`[mailer/resend] sent "${subject}" → ${to} (id: ${data.id})`);
  return { messageId: data.id, response: 'Resend OK' };
}

async function _sendViaSmtp({ to, cc, subject, html }) {
  if (!config.smtp.host) {
    throw new Error('Missing SMTP configuration: set SMTP_HOST (e.g. the college mail server) or configure Brevo/Resend');
  }
  const transport = getSmtpTransporter();
  const info = await transport.sendMail({
    from: config.smtp.from,
    to,
    cc: cc || undefined,
    subject,
    html,
  });

  console.log(`[mailer/smtp] sent "${subject}" → ${to} (messageId: ${info.messageId})`);
  return info;
}

/**
 * Verifies the email transport at startup.
 */
export async function verifySmtp() {
  if (config.mail.transport === 'outbox') {
    console.log(`[mailer] Outbox mode: emails are written to ${config.mail.outboxDir}, not sent`);
    return;
  }
  if (useResend()) {
    console.log('[mailer] Using Resend HTTP API (SMTP ports blocked on this host)');
    return;
  }

  try {
    await getSmtpTransporter().verify();
    console.log('[mailer] SMTP connection verified');
  } catch (err) {
    console.warn('[mailer] SMTP verification failed — emails will be retried on send:', err.message);
  }
}
