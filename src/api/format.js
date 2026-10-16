// Display formatting: Indian currency grouping, dates, and plain-language
// labels for the workflow's status codes.

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** ₹6,50,000.5 — Indian digit grouping. */
export const money = (value) => (value === null || value === undefined ? '—' : inr.format(value));

/** ₹6.5L — compact lakhs for stat tiles. */
export const lakhs = (value) => `₹${((value ?? 0) / 100000).toFixed(1)}L`;

export const quantity = (value) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export const date = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : '—';

export function timeAgo(iso) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

// Tailwind only ships classes it can see written out in full, so each tone is
// spelled completely rather than assembled from parts.
export const TONES = {
  gray: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  teal: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  red: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  sky: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  orange: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
};

const STATUS = {
  request: {
    DRAFT: ['Draft', 'gray'],
    SUBMITTED: ['Submitted', 'amber'],
    UNDER_PURCHASE_COMMITTEE_REVIEW: ['With Purchase Committee', 'amber'],
    UNDER_PRINCIPAL_REVIEW: ['With Principal', 'amber'],
    UNDER_CDC_REVIEW: ['With CDC', 'violet'],
    UNDER_FINAL_AUTHORITY_REVIEW: ['With Chairman & Vice Chairman', 'violet'],
    AWAITING_RESUBMISSION: ['Back for correction', 'orange'],
    APPROVED: ['Approved', 'emerald'],
    PARTIALLY_APPROVED: ['Partially approved', 'teal'],
    REJECTED: ['Rejected', 'red'],
    ESCALATED: ['Escalated', 'violet'],
    FULFILMENT_PENDING: ['Fulfilment pending', 'sky'],
    FULFILLED: ['Fulfilled', 'emerald'],
    CLOSED: ['Closed', 'gray'],
    CARRIED_FORWARD: ['Carried forward', 'gray'],
  },
  item: {
    PENDING: ['Pending', 'amber'],
    APPROVED: ['Approved', 'emerald'],
    PARTIALLY_APPROVED: ['Partly approved', 'teal'],
    REJECTED: ['Not approved', 'red'],
  },
  issue: {
    SUBMITTED: ['Submitted', 'amber'],
    IN_REVIEW: ['In review', 'amber'],
    ESCALATED: ['Escalated', 'violet'],
    RESOLVED: ['Resolved', 'emerald'],
    CLOSED: ['Closed', 'gray'],
  },
  condition: {
    NEW: ['New', 'emerald'],
    GOOD: ['Good', 'sky'],
    FAIR: ['Fair', 'amber'],
    DAMAGED: ['Damaged', 'red'],
    DISPOSED: ['Disposed', 'gray'],
  },
};

export function statusInfo(status, kind = 'request') {
  const [label, tone] = STATUS[kind]?.[status] ?? [status ?? '—', 'gray'];
  return { label, tone: TONES[tone] };
}

export const REVIEW_STATUSES = [
  'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW',
  'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW',
];
export const DECIDED_STATUSES = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CARRIED_FORWARD'];

export const ACTION_LABELS = {
  SUBMIT: 'Submitted',
  APPROVE: 'Approved',
  PARTIAL_APPROVE: 'Partially approved',
  REJECT: 'Rejected',
  ESCALATE: 'Escalated',
  CARRY_FORWARD: 'Carried forward',
  RETURN: 'Sent back for correction',
  RESUBMIT: 'Resubmitted',
  COMMENT: 'Commented',
  FORWARD: 'Forwarded',
  CLOSE: 'Closed',
};

export const ROLE_LABELS = {
  HEAD: 'Head of Department',
  ACTIVITY_INCHARGE: 'Activity In-charge',
  PURCHASE_COMMITTEE: 'Purchase Committee',
  PRINCIPAL: 'Principal',
  CDC_MEMBER: 'CDC Member',
  CDC_GRANT_MEMBER: 'CDC Grant Member',
  CDC_NON_GRANT_MEMBER: 'CDC Non-Grant Member',
  CHAIRMAN: 'Chairman',
  VICE_PRESIDENT: 'Vice Chairman',
  ADMIN: 'Administrator',
};

export const roleLabel = (code) => ROLE_LABELS[code] ?? code;

/** Initials for an avatar: "Dr. V. Rane (Principal)" → "VR". */
export function initials(name = '') {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter((w) => w.length > 0 && !['Dr', 'Prof', 'Shri', 'Smt', 'Mr', 'Mrs', 'Ms'].includes(w));
  return (words.map((w) => w[0]).join('').slice(-2) || '?').toUpperCase();
}
