// The one password policy. Every place that sets a password — accepting an
// invitation, resetting a forgotten one, changing one's own — checks it here
// and hashes it here, so the rule and the hashing cost cannot drift apart.
//
// Passwords are hashed with bcrypt, which is one-way: nobody (administrator,
// developer, database) can ever read a password back.

import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { configService } from './configService.js';
import { HttpError } from './errors.js';

// bcrypt only reads the first 72 bytes; anything longer would be silently
// ignored, so a longer password is refused rather than quietly truncated.
const MAX_BYTES = 72;

// The handful of passwords every attacker tries first.
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456789012', '1234567890',
  'qwertyuiop', 'qwerty123456', 'iloveyou', 'welcome123', 'admin123', 'administrator',
  'letmein123', 'changeme', 'changeme123', 'college123', 'spcollege', 'spcollege123',
]);

/** The rules the sign-in pages show; non-secret. */
export async function passwordRules() {
  return { minLength: await configService.get('auth.password_min_length'), maxBytes: MAX_BYTES };
}

/**
 * Problems with a proposed password, as plain sentences; empty when acceptable.
 * @param {string} password
 * @param {{ email?: string, fullName?: string }} person — whose password it is
 */
export async function passwordProblems(password, { email, fullName } = {}) {
  const { minLength } = await passwordRules();
  const problems = [];
  const value = String(password ?? '');
  const lower = value.toLowerCase();

  if (value.length < minLength) problems.push(`Use at least ${minLength} characters.`);
  if (Buffer.byteLength(value, 'utf8') > MAX_BYTES) problems.push(`Use at most ${MAX_BYTES} bytes (about ${MAX_BYTES} plain characters).`);
  if (value && new Set(value).size === 1) problems.push('Do not repeat a single character.');
  if (COMMON.has(lower.replace(/[^a-z0-9]/g, ''))) problems.push('This password is too common.');

  const local = String(email ?? '').split('@')[0].toLowerCase();
  if (local.length >= 3 && lower.includes(local)) problems.push('Do not include your email address.');
  const nameParts = String(fullName ?? '').toLowerCase().split(/[^a-z]+/).filter((p) => p.length >= 3);
  if (nameParts.some((part) => lower.includes(part))) problems.push('Do not include your name.');

  return problems;
}

/** Throws 422 listing every problem, or returns quietly. */
export async function assertPasswordAcceptable(password, person) {
  const problems = await passwordProblems(password, person);
  if (problems.length) {
    throw new HttpError(422, 'Choose a stronger password', { code: 'WEAK_PASSWORD', details: problems });
  }
}

export function hashPassword(password) {
  return bcrypt.hash(password, config.bcryptRounds);
}
