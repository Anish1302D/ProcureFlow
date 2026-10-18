// Emails about a person's own account: invitations, password resets, email
// changes and security notices.
//
// Nothing here is hard-coded: the institution's names and support address come
// from configuration, links from APP_URL, and the time zone from APP_TIMEZONE.
// Links put the one-time token after "#", which browsers never send to a
// server, so it cannot end up in any web server's access log.

import { config } from './config.js';
import { configService } from './configService.js';
import { sendMail } from './mailer.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function branding() {
  const read = async (key) => { try { return await configService.get(key); } catch { return ''; } };
  return {
    institution: await read('institution.name'),
    system: await read('institution.system_name'),
    support: await read('institution.support_email'),
  };
}

/** "Saturday, 25 October 2026, 10:00 am" in the institution's time zone. */
function when(date) {
  return new Date(date).toLocaleString('en-IN', {
    timeZone: config.timeZone, weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** "7 days", "60 minutes" — how long a link lasts, in plain words. */
function lifetime(from, to) {
  const minutes = Math.round((new Date(to) - new Date(from)) / 60000);
  if (minutes >= 2880 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes >= 120 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function accountLink(path, token) {
  if (!config.appUrl) throw new Error('APP_URL is not configured');
  return `${config.appUrl}/#/${path}/${token}`;
}

function layout(brand, { heading, paragraphs, button, footnote }) {
  const title = escapeHtml(brand.system || brand.institution || 'Approval Hub');
  const button_ = button ? `
      <p style="margin:24px 0">
        <a href="${escapeHtml(button.href)}" style="background:#4f46e5;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(button.label)}</a>
      </p>
      <p style="font-size:13px;color:#4b5563">If the button does not work, copy this address into your browser:<br>
        <span style="word-break:break-all;color:#4f46e5">${escapeHtml(button.href)}</span></p>` : '';
  const support = brand.support
    ? `<p style="font-size:12px;color:#6b7280">Questions? Write to <a href="mailto:${escapeHtml(brand.support)}">${escapeHtml(brand.support)}</a>.</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111827">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
    <p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 8px">${title}</p>
    <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
    ${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${p}</p>`).join('\n    ')}
    ${button_}
    ${footnote ? `<p style="font-size:13px;color:#4b5563;margin-top:20px">${footnote}</p>` : ''}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:12px;color:#6b7280">This is an automatic message from ${escapeHtml(brand.institution || title)}. Never share this email or its link: anyone with the link can use it.</p>
    ${support}
  </div></body></html>`;
}

/**
 * "You have been invited to the approval hub as CDC Grant Member."
 * @param {{ to: string, fullName: string, roleNames: string[], invitedBy?: string, token: string, issuedAt: Date, expiresAt: Date }} o
 */
export async function sendInvitation(o) {
  const brand = await branding();
  const place = escapeHtml(brand.system || 'the approval hub');
  const roles = o.roleNames.length ? escapeHtml(o.roleNames.join(', ')) : 'a member';
  const html = layout(brand, {
    heading: `You're invited to ${brand.institution ? escapeHtml(brand.institution) : 'the'} approval hub`,
    paragraphs: [
      `Dear ${escapeHtml(o.fullName)},`,
      `${o.invitedBy ? `${escapeHtml(o.invitedBy)} has` : 'You have been'} invited ${o.invitedBy ? 'you ' : ''}to join <strong>${place}</strong> as <strong>${roles}</strong>.`,
      'Open the link below and choose your own password. Nobody else, including the administrator, will ever know it.',
    ],
    button: { label: 'Accept invitation and set password', href: accountLink('accept-invite', o.token) },
    footnote: `This invitation can be used once and stays valid for ${lifetime(o.issuedAt, o.expiresAt)}, until ${escapeHtml(when(o.expiresAt))}. If you were not expecting it, you can ignore this email.`,
  });
  return sendMail({ to: o.to, subject: `Invitation to ${brand.system || 'the approval hub'}`, html });
}

/** @param {{ to: string, fullName: string, token: string, issuedAt: Date, expiresAt: Date }} o */
export async function sendPasswordReset(o) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'Reset your password',
    paragraphs: [
      `Dear ${escapeHtml(o.fullName)},`,
      'We received a request to reset the password for your account. Open the link below to choose a new one.',
    ],
    button: { label: 'Choose a new password', href: accountLink('reset-password', o.token) },
    footnote: `The link works once and expires in ${lifetime(o.issuedAt, o.expiresAt)}, at ${escapeHtml(when(o.expiresAt))}. If you did not ask for this, ignore this email — your password stays the same.`,
  });
  return sendMail({ to: o.to, subject: 'Reset your password', html });
}

/** Sent after any password change, so the owner notices one they did not make. */
export async function sendPasswordChanged({ to, fullName, at = new Date() }) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'Your password was changed',
    paragraphs: [
      `Dear ${escapeHtml(fullName)},`,
      `The password for your account was changed on ${escapeHtml(when(at))}, and every device that was signed in has been signed out.`,
      `If this was you, there is nothing to do. If it was not, use <strong>Forgot password?</strong> on the sign-in page straight away${brand.support ? ' and tell the college' : ''}.`,
    ],
  });
  return sendMail({ to, subject: 'Your password was changed', html });
}

/** @param {{ to: string, fullName: string, oldEmail: string, token: string, issuedAt: Date, expiresAt: Date }} o */
export async function sendEmailChangeConfirmation(o) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'Confirm your new email address',
    paragraphs: [
      `Dear ${escapeHtml(o.fullName)},`,
      `Your account's email is being changed from <strong>${escapeHtml(o.oldEmail)}</strong> to this address. It changes only when you confirm.`,
    ],
    button: { label: 'Confirm this email address', href: accountLink('confirm-email', o.token) },
    footnote: `The link works once and expires in ${lifetime(o.issuedAt, o.expiresAt)}, at ${escapeHtml(when(o.expiresAt))}.`,
  });
  return sendMail({ to: o.to, subject: 'Confirm your new email address', html });
}

/** Tells the current address that someone asked to move the account away from it. */
export async function sendEmailChangeNotice({ to, fullName, newEmail }) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'A change to your account email was requested',
    paragraphs: [
      `Dear ${escapeHtml(fullName)},`,
      `A request was made to change your account's email to <strong>${escapeHtml(newEmail)}</strong>. Nothing changes unless that address confirms.`,
      'If you did not expect this, tell the college administrator. Until it is confirmed, sign-in and password resets stay with this address.',
    ],
  });
  return sendMail({ to, subject: 'A change to your account email was requested', html });
}

/** Sent to the old address once an email change has been confirmed. */
export async function sendEmailChanged({ to, fullName, newEmail }) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'Your account email was changed',
    paragraphs: [
      `Dear ${escapeHtml(fullName)},`,
      `Your account now uses <strong>${escapeHtml(newEmail)}</strong>. This address will no longer receive sign-in or password emails.`,
      'If you did not expect this, tell the college administrator straight away.',
    ],
  });
  return sendMail({ to, subject: 'Your account email was changed', html });
}

/** Several wrong passwords in a row: tell the owner, and how to get back in now. */
export async function sendAccountLocked({ to, fullName, until }) {
  const brand = await branding();
  const html = layout(brand, {
    heading: 'Sign-in paused after several wrong passwords',
    paragraphs: [
      `Dear ${escapeHtml(fullName)},`,
      `Someone entered the wrong password for your account several times, so sign-in is paused until ${escapeHtml(when(until))}.`,
      'If it was you, wait until then or use <strong>Forgot password?</strong> on the sign-in page to choose a new password straight away. If it was not you, resetting your password is the safest step.',
    ],
  });
  return sendMail({ to, subject: 'Sign-in paused on your account', html });
}
