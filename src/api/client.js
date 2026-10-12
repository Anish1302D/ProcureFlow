// The one place the frontend talks to the API.
//
// Requests go to /api on the same origin: the Vite dev server proxies them to
// the API in development, and IIS or nginx does the same in production.

const BASE = import.meta.env.VITE_API_BASE ?? '';
const TOKEN_KEY = 'spc.session';

let token = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  // Storage can be unavailable (private windows, blocked site data); the
  // session then simply lasts until the tab is closed.
}

export function setToken(value) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* see above */
  }
}

export const hasToken = () => Boolean(token);

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

let sessionExpired = () => {};
/** Called when a signed-in request is refused as unauthenticated. */
export function onSessionExpired(handler) {
  sessionExpired = handler;
}

function headers(extra = {}) {
  return token ? { Authorization: `Bearer ${token}`, ...extra } : extra;
}

async function handle(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401 && token) sessionExpired();
    throw new ApiError(res.status, body);
  }
  return body;
}

import { MOCK_USERS, MOCK_REQUESTS, MOCK_DASHBOARD, MOCK_BUDGET_SPEND, MOCK_ISSUES } from './mockData';

let currentMockUser = MOCK_USERS['principal@spcollege.edu'];

function getMockResponse(path, { method = 'GET', body } = {}) {
  const cleanPath = path.split('?')[0];

  if (cleanPath === '/api/auth/login' && method === 'POST') {
    const email = body?.email?.toLowerCase().trim();
    const user = MOCK_USERS[email] || Object.values(MOCK_USERS)[0];
    currentMockUser = user;
    return { token: 'mock-jwt-token-' + user.id, user };
  }

  if (cleanPath === '/api/auth/me') {
    return currentMockUser;
  }

  if (cleanPath === '/api/dashboard') {
    return MOCK_DASHBOARD;
  }

  if (cleanPath === '/api/reports/by-budget-head') {
    return MOCK_BUDGET_SPEND;
  }

  if (cleanPath === '/api/reports/summary') {
    return {
      financialYear: { id: 1, label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
      generatedAt: new Date().toISOString(),
      generatedBy: { id: currentMockUser.id, name: currentMockUser.name, roles: currentMockUser.roles },
      byBudgetHead: [
        { budgetHead: { id: 1, code: 'LAB', name: 'Laboratory', headType: 'CAPITAL' }, requests: 6, approved: 4, partial: 1, rejected: 0, pending: 2, requested: 12316700, sanctioned: 12070000 },
        { budgetHead: { id: 2, code: 'MAINT', name: 'Maintenance', headType: 'REVENUE' }, requests: 1, approved: 0, partial: 0, rejected: 0, pending: 1, requested: 1000000, sanctioned: 0 },
        { budgetHead: { id: 3, code: 'IT', name: 'IT Equipment', headType: 'CAPITAL' }, requests: 10, approved: 3, partial: 1, rejected: 2, pending: 5, requested: 754475, sanctioned: 35096 },
        { budgetHead: { id: 4, code: 'OFF', name: 'Office Expenses', headType: 'REVENUE' }, requests: 1, approved: 0, partial: 0, rejected: 1, pending: 0, requested: 100000, sanctioned: 0 },
      ],
      byStatus: [
        { status: 'APPROVED', requests: 6, requested: 10000000, sanctioned: 10000000 },
        { status: 'UNDER_PRINCIPAL_REVIEW', requests: 5, requested: 1500000, sanctioned: 0 },
        { status: 'UNDER_CDC_REVIEW', requests: 3, requested: 2000000, sanctioned: 0 },
        { status: 'REJECTED', requests: 4, requested: 671175, sanctioned: 0 },
      ],
      byDepartment: [
        { name: 'Computer Science', code: 'CS', requests: 10, approved: 4, rejected: 1, pending: 5, requested: 8000000, sanctioned: 7500000 },
        { name: 'Physics', code: 'PHY', requests: 5, approved: 2, rejected: 1, pending: 2, requested: 4000000, sanctioned: 3500000 },
        { name: 'Chemistry', code: 'CHEM', requests: 3, approved: 1, rejected: 1, pending: 1, requested: 2171175, sanctioned: 1105096 },
      ],
      byStage: [
        { stage: 'Principal Review', code: 'PRINCIPAL', requests: 5, amount: 1500000, avgDays: 2.4, maxDays: 5 },
        { stage: 'CDC Review', code: 'CDC', requests: 3, amount: 2000000, avgDays: 4.8, maxDays: 9 },
      ],
      byItemType: [
        { itemType: 'CAPITAL', lines: 18, requestedQty: 45, approvedQty: 40, requested: 13071175, approved: 12105096 },
        { itemType: 'CONSUMABLE', lines: 12, requestedQty: 250, approvedQty: 100, requested: 1100000, approved: 0 },
      ],
      byFunding: [
        { funding: 'GRANT', requests: 12, approved: 5, rejected: 2, pending: 5, requested: 10000000, sanctioned: 8500000 },
        { funding: 'NON_GRANT', requests: 6, approved: 2, rejected: 1, pending: 3, requested: 4171175, sanctioned: 3605096 },
      ],
      monthly: [
        { month: '2026-06', requests: 4, approved: 2, rejected: 0, pending: 2, requested: 3000000, sanctioned: 2500000 },
        { month: '2026-07', requests: 6, approved: 3, rejected: 1, pending: 2, requested: 6000000, sanctioned: 5500000 },
        { month: '2026-08', requests: 8, approved: 2, rejected: 2, pending: 4, requested: 5171175, sanctioned: 4105096 },
      ],
      provisions: [
        { department: 'Computer Science', budgetHead: 'IT Equipment', allocated: 10000000, utilized: 7500000, committed: 1000000, remaining: 1500000 },
        { department: 'Physics', budgetHead: 'Laboratory', allocated: 5000000, utilized: 3500000, committed: 500000, remaining: 1000000 },
      ],
      pendingOverThreeDays: [
        { requestNumber: 'REQ-2026-0012', title: 'High Performance GPU Cluster Server Upgrade', raisedBy: 'Prof. A. Kulkarni', status: 'UNDER_CDC_REVIEW', stage: 'CDC Review', amount: 1500000, daysPending: 9, submittedAt: '2026-09-24T10:00:00Z' },
        { requestNumber: 'REQ-2026-0015', title: 'Spectrometer Calibration Kit', raisedBy: 'Dr. S. Joshi', status: 'UNDER_PRINCIPAL_REVIEW', stage: 'Principal Review', amount: 250000, daysPending: 5, submittedAt: '2026-09-28T14:30:00Z' },
      ],
      register: [
        { requestNumber: 'REQ-2026-0001', title: 'Advanced Microscope Setup', status: 'APPROVED', raisedBy: 'Dr. M. Patwardhan', department: 'Physics', budgetHead: 'Laboratory', stage: 'Principal Review', requested: 500000, sanctioned: 500000, submittedAt: '2026-06-10T09:00:00Z', closedAt: '2026-06-15T15:00:00Z' },
        { requestNumber: 'REQ-2026-0002', title: 'Laboratory Reagents Package', status: 'UNDER_PRINCIPAL_REVIEW', raisedBy: 'Dr. R. Shinde', department: 'Chemistry', budgetHead: 'Laboratory', stage: 'Principal Review', requested: 350000, sanctioned: null, submittedAt: '2026-08-01T11:00:00Z', closedAt: null },
      ],
      issues: [
        { status: 'SUBMITTED', n: 3 },
        { status: 'IN_REVIEW', n: 2 },
        { status: 'RESOLVED', n: 1 },
      ],
    };
  }

  if (cleanPath === '/api/issues') {
    return MOCK_ISSUES;
  }

  if (cleanPath === '/api/requests') {
    return {
      rows: MOCK_REQUESTS,
      total: MOCK_REQUESTS.length,
      page: 1,
      limit: 20,
    };
  }

  const reqMatch = cleanPath.match(/^\/api\/requests\/([^/]+)$/);
  if (reqMatch) {
    const id = reqMatch[1];
    const found = MOCK_REQUESTS.find((r) => r.id === id || r.requestNumber === id) || MOCK_REQUESTS[0];
    return found;
  }

  const reportMatch = cleanPath.match(/^\/api\/requests\/([^/]+)\/report$/);
  if (reportMatch) {
    const id = reportMatch[1];
    const found = MOCK_REQUESTS.find((r) => r.id === id || r.requestNumber === id) || MOCK_REQUESTS[0];
    return {
      title: 'Comprehensive Purchase Request Report',
      kind: 'complete',
      requestNumber: found.requestNumber,
      generatedAt: new Date().toISOString(),
      request: found,
      items: found.items,
      workflow: found.workflow,
      messages: found.messages,
      documents: found.documents,
      resubmissions: found.resubmissions || [],
      budget: found.budget,
      decision: found.decision,
      auditSummary: found.auditSummary,
      certification: found.certification,
      sections: ['request', 'items', 'budget', 'workflow', 'messages', 'documents', 'decision', 'audit', 'certification'],
    };
  }

  if (cleanPath === '/api/budget-heads') {
    return [
      { id: 'bh-1', code: 'IT', name: 'Information Technology Infrastructure' },
      { id: 'bh-2', code: 'LAB', name: 'Laboratory Equipment & Consumables' },
      { id: 'bh-3', code: 'LIB', name: 'Library & Academic Resources' },
    ];
  }

  if (cleanPath === '/api/departments') {
    return [
      { id: 'dept-1', code: 'CS', name: 'Computer Science' },
      { id: 'dept-2', code: 'PHY', name: 'Physics' },
      { id: 'dept-3', code: 'CHEM', name: 'Chemistry' },
    ];
  }

  if (cleanPath === '/api/financial-years') {
    return [
      { id: 'fy-2026', code: '2026-2027', name: '2026-2027' },
    ];
  }

  return { status: 'ok', rows: [] };
}

/** JSON request. `body` is sent as JSON; `form` as multipart (file uploads). */
export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const init = { method, signal, headers: headers() };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers = headers({ 'Content-Type': 'application/json' });
    init.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${BASE}${path}`, init);
    if (res.status >= 502 && res.status <= 504) {
      return getMockResponse(path, { method, body });
    }
    return await handle(res);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      return getMockResponse(path, { method, body });
    }
    throw err;
  }
}

/**
 * Downloads a file that needs the session token. A plain link can't carry the
 * Authorization header, so the file is fetched and handed to the browser.
 */
export async function download(path, fallbackName = 'download') {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers() });
    if (!res.ok) {
      if (path.endsWith('/report.pdf')) {
        const reportPath = path.replace('/report.pdf', '/report');
        const reportData = await api(reportPath);
        const { generateOfficialPdf } = await import('../utils/officialPdfGenerator');
        await generateOfficialPdf(reportData, `${reportData.requestNumber || 'SP_College'}_official_report.pdf`);
        return;
      }
      await handle(res);
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
    const name = match ? decodeURIComponent(match[1] ?? match[2]) : fallbackName;

    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    if (path.endsWith('/report.pdf')) {
      const reportPath = path.replace('/report.pdf', '/report');
      const reportData = await api(reportPath);
      const { generateOfficialPdf } = await import('../utils/officialPdfGenerator');
      await generateOfficialPdf(reportData, `${reportData.requestNumber || 'SP_College'}_official_report.pdf`);
      return;
    }
    throw err;
  }
}

/**
 * Opens a printable page the session token is needed for. The window is opened
 * on the click itself — before the fetch — or the browser treats it as a popup
 * and blocks it.
 */
export async function openPrintable(path) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers() });
    if (!res.ok) {
      win?.close();
      await handle(res);
      return;
    }
    const html = await res.text();
    if (!win) throw new Error('Allow pop-ups for this site to open the report');
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Query string from an object, skipping empty values. */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
