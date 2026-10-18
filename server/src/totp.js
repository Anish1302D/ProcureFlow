// Time-based one-time passwords (RFC 6238), the 6-digit codes shown by
// authenticator apps such as Google Authenticator or Microsoft Authenticator.
// Implemented on Node's built-in crypto: HMAC-SHA1, 30-second steps.

import crypto from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new random secret, base32 as authenticator apps expect (160 bits). */
export function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The time step a moment falls in. */
export function stepAt(ms = Date.now()) {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** The code for a secret at a given step. */
export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * The step a code matches, allowing one step either side for clock drift, or
 * null. Callers refuse a step at or below the last one used, so a code cannot
 * be replayed.
 */
export function matchingStep(secret, code, now = Date.now()) {
  const typed = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    const expected = codeAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return step;
  }
  return null;
}

/** The otpauth:// address authenticator apps understand. */
export function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
