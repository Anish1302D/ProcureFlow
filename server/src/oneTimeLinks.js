// One-time link tokens, shared by invitations, password resets and email
// changes. A token is 32 random bytes; only its SHA-256 hash is ever stored,
// so a leaked database cannot be used to open anyone's link. The raw token
// exists in exactly one place: the email it is sent in.

import crypto from 'node:crypto';
import { HttpError } from './errors.js';

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Raw tokens are 64 hex characters; anything else is refused before any lookup. */
export function assertTokenShape(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/i.test(token)) {
    throw new HttpError(404, 'This link is not valid. Check that you copied the whole address.', { code: 'LINK_INVALID' });
  }
}

/**
 * Turns a link's database status (or the STxxx error from a consume function)
 * into the message the person sees. `kind` names the link in plain words.
 */
export function linkError(statusOrCode, kind) {
  const map = {
    INVALID: [404, `This ${kind} link is not valid. Check that you copied the whole address.`, 'LINK_INVALID'],
    ST001: [404, `This ${kind} link is not valid. Check that you copied the whole address.`, 'LINK_INVALID'],
    ALREADY_USED: [410, `This ${kind} link has already been used.`, 'LINK_USED'],
    ST002: [410, `This ${kind} link has already been used.`, 'LINK_USED'],
    EXPIRED: [410, `This ${kind} link has expired.`, 'LINK_EXPIRED'],
    ST003: [410, `This ${kind} link has expired.`, 'LINK_EXPIRED'],
    REVOKED: [410, `This ${kind} link was cancelled or replaced by a newer one. Use the most recent email.`, 'LINK_REVOKED'],
    ST004: [410, `This ${kind} link was cancelled or replaced by a newer one. Use the most recent email.`, 'LINK_REVOKED'],
  };
  const hit = map[statusOrCode];
  return hit ? new HttpError(hit[0], hit[1], { code: hit[2] }) : null;
}

/** Headers for every response that handles a link: never cached anywhere. */
export const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  Expires: '0',
};
