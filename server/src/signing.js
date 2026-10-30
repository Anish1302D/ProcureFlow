import crypto from 'node:crypto';
import { config } from './config.js';

// Approval seals.
//
// WHAT THIS IS
// A keyed hash (HMAC-SHA256) over the exact content of a decision: which
// request, which action, who took it, and every per-item quantity and amount.
// It is stored in digital_signatures and can be recomputed at any time from
// the recorded decision. If anyone later edits a decision row directly in the
// database — changes an approved amount, swaps the approver — the seal no
// longer matches, and the timeline reports it.
//
// WHAT THIS IS NOT
// A legal digital signature. The key belongs to the server, not the approver,
// so it proves the record is unaltered since the API wrote it; it does not
// prove the approver personally signed it. That needs per-user keys such as a
// DSC token and is outside this API's scope.

const VERSION = 'v1';

const money = (value) => Number(value).toFixed(2);

/**
 * Canonical text for a decision. Field order is fixed and items are sorted by
 * id, so the same decision always produces the same text whether it is built
 * from the incoming request or reconstructed from stored rows.
 */
export function canonicalDecision({ requestId, action, actorId, decisions, comments, rejectionReason }) {
  const items = [...decisions]
    .map((d) => [d.requestItemId, money(d.approvedQuantity), money(d.approvedAmount)])
    // Ordinal, not localeCompare: collation must not vary by server locale.
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify([
    VERSION,
    requestId,
    action,
    actorId,
    items,
    comments ?? null,
    rejectionReason ?? null,
  ]);
}

export function seal(decision) {
  const mac = crypto
    .createHmac('sha256', config.signingSecret)
    .update(canonicalDecision(decision))
    .digest('hex');
  return `hmac-sha256:${VERSION}:${mac}`;
}

export function verifySeal(stored, decision) {
  if (typeof stored !== 'string') return false;
  const expected = Buffer.from(seal(decision));
  const actual = Buffer.from(stored);
  // Constant-time: an early-exit comparison leaks how much of a forgery matched.
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
