import React, { useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Building2,
  CheckCircle2,
  FileDown,
  FileText,
  IndianRupee,
  Layers,
  Loader2,
  Lock,
  TrendingUp,
} from 'lucide-react';
import { api, qs } from '../api/client';
import { lakhs, money } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/ui/StatCard';
import { DataState } from '../components/ui/States';

/**
 * Spending by budget head and department, from real requests.
 * Higher authorities (Principal, CDC, Chairman, VP, Admin) can download Approval & Budget reports
 * (both combined and department-wise), Requisitions reports, and Issues reports.
 * HODs and faculty members can download Requisitions and Issues reports for their department.
 */
export const ReportsAnalytics = () => {
  const { user } = useApp();
  const canDownloadApprovalBudget = Boolean(user?.can?.downloadApprovalBudget);

  const years = useApi('/api/financial-years');
  const departments = useApi('/api/departments');

  const [year, setYear] = useState('');
  const [department, setDepartment] = useState(
    canDownloadApprovalBudget
      ? ''
      : (user?.departmentId ? String(user.departmentId) : '')
  );

  const spend = useApi(`/api/reports/by-budget-head${qs({
    financialYearId: year || undefined,
    departmentId: department || undefined,
  })}`);

  const rows = spend.data?.rows ?? [];
  const currentDept = spend.data?.department;

  const totals = rows.reduce((t, r) => ({
    requests: t.requests + r.requests,
    approved: t.approved + r.approved,
    rejected: t.rejected + r.rejected,
    requested: t.requested + r.requested,
    sanctioned: t.sanctioned + r.sanctioned,
  }), { requests: 0, approved: 0, rejected: 0, requested: 0, sanctioned: 0 });

  const decided = totals.approved + totals.rejected;
  const max = Math.max(1, ...rows.map((r) => r.requested));

  const [downloadingType, setDownloadingType] = useState(null);
  const [downloadError, setDownloadError] = useState('');

  const handleDownload = async (type, forcedDept = undefined) => {
    setDownloadingType(type);
    setDownloadError('');
    try {
      const targetDept = forcedDept !== undefined ? forcedDept : (department || undefined);
      const params = { financialYearId: year || undefined };
      if (targetDept) params.departmentId = targetDept;

      if (type === 'approval-budget' || type === 'combined') {
        params.reportType = 'approval-budget';
      } else if (type === 'requests') {
        params.reportType = 'requests';
      } else if (type === 'issues') {
        params.reportType = 'issues';
      }

      if (type === 'combined') {
        delete params.departmentId;
      }

      const data = await api(`/api/reports/summary${qs(params)}`);
      const fyTag = (data.financialYear?.label ?? 'current').replace(/[^0-9A-Za-z-]/g, '');
      const deptTag = data.department?.code ? `_${data.department.code}` : '_Combined';

      if (type === 'approval-budget' || type === 'combined') {
        const { generateReportsSummaryPdf } = await import('../utils/reportsSummaryPdf');
        generateReportsSummaryPdf(
          data,
          `SP_College_Approval_Budget_Report${type === 'combined' ? '_Combined' : deptTag}_FY_${fyTag}.pdf`,
        );
      } else if (type === 'requests') {
        const { generateDepartmentRequestsPdf } = await import('../utils/departmentRequestsPdf');
        generateDepartmentRequestsPdf(
          data,
          `SP_College_Requisitions_Report${deptTag}_FY_${fyTag}.pdf`,
        );
      } else if (type === 'issues') {
        const { generateIssuesReportPdf } = await import('../utils/issuesReportPdf');
        generateIssuesReportPdf(
          data,
          `SP_College_Issues_Report${deptTag}_FY_${fyTag}.pdf`,
        );
      }
    } catch (err) {
      setDownloadError(err?.message ?? 'Could not generate the report.');
    } finally {
      setDownloadingType(null);
    }
  };

  const deptList = departments.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header & Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-200">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" /> Reports & Analytics
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Submitted requests and budget sanctions for FY {spend.data?.financialYear ?? '…'}
            {currentDept ? ` · Department: ${currentDept.name} (${currentDept.code})` : ' · College-Wide (All Departments)'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Department Filter */}
          {canDownloadApprovalBudget ? (
            <div className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-gray-400" />
              <select
                id="report-department-select"
                aria-label="Department scope"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
              >
                <option value="">All Departments (Combined Report)</option>
                {deptList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700">
              <Building2 className="w-3.5 h-3.5 text-indigo-500" />
              <span>{user?.departmentName ? `${user.departmentName} (${user.departmentCode})` : 'My Department'}</span>
            </div>
          )}

          {/* Financial Year Filter */}
          <select
            aria-label="Financial year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-800 shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">Current year</option>
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                FY {y.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Scope banner & Action Buttons Panel */}
      <div className="bg-gradient-to-r from-slate-50 to-indigo-50/40 rounded-2xl border border-indigo-100 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
              currentDept ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
            }`}>
              {currentDept ? <Building2 className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
              {currentDept ? `Department Report: ${currentDept.name}` : 'Combined College Report'}
            </span>
            <span className="text-xs text-gray-500">
              {currentDept ? 'Filtered to departmental line items & allocations' : 'Aggregated across all departments & budget heads'}
            </span>
          </div>
          <p className="text-xs text-gray-600">
            {canDownloadApprovalBudget
              ? 'Authorized for institutional budget reports, departmental requisitions, and facility issue audits.'
              : 'Authorized for departmental requisition schedules and maintenance issue logs.'}
          </p>
        </div>

        {/* Download Buttons Group */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Approval & Budget Report (Restricted to Higher Authority) */}
          {canDownloadApprovalBudget ? (
            <>
              <button
                id="download-approval-budget-pdf"
                type="button"
                onClick={() => handleDownload('approval-budget')}
                disabled={Boolean(downloadingType) || spend.loading}
                className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
                title={currentDept ? `Download Approval & Budget Report for ${currentDept.name}` : 'Download Combined Approval & Budget Report'}
              >
                {downloadingType === 'approval-budget' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                {downloadingType === 'approval-budget'
                  ? 'Generating…'
                  : currentDept
                    ? `${currentDept.code} Budget Report (PDF)`
                    : 'Download Approval & Budget Report (PDF)'}
              </button>

              {/* Shortcut: Combined Report when a single department is selected */}
              {currentDept && (
                <button
                  id="download-combined-budget-pdf"
                  type="button"
                  onClick={() => handleDownload('combined')}
                  disabled={Boolean(downloadingType) || spend.loading}
                  className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-indigo-200 text-indigo-700 rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
                  title="Download All-Departments Combined Approval & Budget Report"
                >
                  {downloadingType === 'combined' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  ) : (
                    <Layers className="w-3.5 h-3.5 text-indigo-600" />
                  )}
                  {downloadingType === 'combined' ? 'Generating…' : 'Combined College Report (PDF)'}
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5" title="Only Principal, CDC Members, Chairman and Vice President may download the financial budget sanction report">
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Budget Sanction Report: Reserved for Principal & CDC</span>
            </div>
          )}

          {/* Department Requisitions Report (HOD + Higher Authority) */}
          <button
            id="download-requests-pdf"
            type="button"
            onClick={() => handleDownload('requests')}
            disabled={Boolean(downloadingType) || spend.loading}
            className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
            title="Download itemised department requisitions and line items report"
          >
            {downloadingType === 'requests' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-600" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
            )}
            {downloadingType === 'requests' ? 'Generating…' : 'Requisitions Report (PDF)'}
          </button>

          {/* Issues Raised Report (HOD + Higher Authority) */}
          <button
            id="download-issues-pdf"
            type="button"
            onClick={() => handleDownload('issues')}
            disabled={Boolean(downloadingType) || spend.loading}
            className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 rounded-lg px-3 py-2 text-xs font-semibold shadow-sm transition-colors"
            title="Download facility and campus issues log report"
          >
            {downloadingType === 'issues' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-600" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            )}
            {downloadingType === 'issues' ? 'Generating…' : 'Issues Log Report (PDF)'}
          </button>
        </div>
      </div>

      {downloadError && (
        <div role="alert" className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Requests submitted"
          value={totals.requests}
          subtext={`${lakhs(totals.requested)} requested`}
          icon={TrendingUp}
          color="indigo"
        />
        <StatCard
          title="Sanctioned"
          value={lakhs(totals.sanctioned)}
          subtext={totals.requested ? `${Math.round((totals.sanctioned / totals.requested) * 100)}% of the amount requested` : 'Nothing requested yet'}
          icon={IndianRupee}
          color="emerald"
        />
        <StatCard
          title="Approval rate"
          value={decided ? `${Math.round((totals.approved / decided) * 100)}%` : '—'}
          subtext={decided ? `${totals.approved} approved of ${decided} decided` : 'No decisions yet'}
          icon={CheckCircle2}
          color="amber"
        />
      </div>

      {/* Budget Head Breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              By budget head {currentDept ? `— ${currentDept.name}` : '(All Heads)'}
            </h3>
            <p className="text-[11px] text-gray-500">Expenditure allocation and sanction distribution</p>
          </div>
          <span className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-indigo-200" /> Requested</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-emerald-500" /> Sanctioned</span>
          </span>
        </div>

        <DataState state={spend} isEmpty={rows.length === 0} empty={{ title: 'No submitted requests in this scope' }}>
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.budgetHead.id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-gray-800">
                    {r.budgetHead.name}
                    <span className="font-normal text-gray-400">
                      {' '}· {r.budgetHead.headType.toLowerCase()} · {r.requests} request{r.requests === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="tabular-nums text-gray-600">
                    <strong className="text-emerald-700">{money(r.sanctioned)}</strong> of {money(r.requested)}
                  </span>
                </div>
                <div
                  className="relative w-full h-2.5 rounded-full bg-gray-100 overflow-hidden"
                  role="img"
                  aria-label={`${r.budgetHead.name}: ${money(r.sanctioned)} sanctioned of ${money(r.requested)} requested`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-indigo-200 rounded-full transition-all duration-300"
                    style={{ width: `${(r.requested / max) * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full transition-all duration-300"
                    style={{ width: `${(r.sanctioned / max) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </div>
    </div>
  );
};
