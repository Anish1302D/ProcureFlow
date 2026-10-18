// 2-step verification building blocks.
//
// * Authenticator secrets are stored encrypted with AES-256-GCM under
//   MFA_ENCRYPTION_KEY, which lives only in the server's environment. A copy
//   of the database alone cannot produce anyone's codes.
// * Recovery codes are stored as HMAC-SHA256 keyed with the same key, so they
//   cannot be guessed offline from a database copy either.
// * After a correct password, a user who needs a second step gets a
//   short-lived challenge, signed with a key derived from (but different to)
//   the session key, so it can never be used as a session itself.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './errors.js';

function key() {
  if (!config.mfaKey) {
    throw new HttpError(503, '2-step verification is unavailable: MFA_ENCRYPTION_KEY is not configured on the server.', { code: 'MFA_KEY_REQUIRED' });
  }
  return config.mfaKey;
}

/** "v1:<iv>:<tag>:<ciphertext>", all base64. */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored) {
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1') throw new Error('Unknown secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Recovery codes: 10 of them, "XXXXX-XXXXX" from an unambiguous alphabet
// (no 0/O or 1/I), about 50 bits each.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const chars = Array.from(crypto.randomBytes(10), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normaliseRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code) {
  return crypto.createHmac('sha256', key()).update(`recovery:${normaliseRecoveryCode(code)}`).digest('hex');
}

// ---------------------------------------------------------------------------
// Challenges between the password step and the code step
// ---------------------------------------------------------------------------

const CHALLENGE_AUDIENCE = 'mfa-challenge';

function challengeKey() {
  return crypto.createHmac('sha256', config.jwtSecret).update('mfa-challenge-key').digest();
}

/** @param {'verify'|'enrol'} step */
export function issueChallenge(userId, tokenVersion, step) {
  return jwt.sign({ step, v: tokenVersion }, challengeKey(), {
    subject: userId, audience: CHALLENGE_AUDIENCE, expiresIn: '10m', algorithm: 'HS256',
  });
}

export function readChallenge(token, step) {
  let payload;
  try {
    payload = jwt.verify(String(token ?? ''), challengeKey(), { algorithms: ['HS256'], audience: CHALLENGE_AUDIENCE });
  } catch {
    throw new HttpError(401, 'This sign-in attempt has expired. Please sign in again.', { code: 'CHALLENGE_EXPIRED' });
  }
  if (payload.step !== step) {
    throw new HttpError(401, 'This sign-in attempt has expired. Please sign in again.', { code: 'CHALLENGE_EXPIRED' });
  }
  return { userId: payload.sub, tokenVersion: payload.v };
}
