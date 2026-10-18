import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, ArrowRight, CheckCircle2,
  GitMerge, Info, Loader2, Plus, RefreshCw, Save,
  Settings, Sliders, Trash2,
  UserCheck, Users, Workflow,
} from 'lucide-react';
import { money } from '../api/format';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useApp } from '../context/AppContext';
import { DataState } from '../components/ui/States';

const STAGE_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500', num: 'bg-blue-100 text-blue-700' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500', num: 'bg-indigo-100 text-indigo-700' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: 'bg-violet-500', num: 'bg-violet-100 text-violet-700' },
  { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500', num: 'bg-purple-100 text-purple-700' },
];

export const SettingsPreferences = () => {
  const { user, showToast } = useApp();
  const isAdmin = user?.roles?.includes('ADMIN');

  const stagesApi = useApi('/api/workflow/stages');
  const stages = stagesApi.data ?? [];

  const [activeTab, setActiveTab] = useState('rules'); // 'rules' | 'approvers' | 'flags' | 'preview'

  // Admin config state
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState('');

  // Form values
  const [principalMax, setPrincipalMax] = useState(50000);
  const [cdcMax, setCdcMax] = useState(500000);
  const [vcTitle, setVcTitle] = useState('Vice Chairman');
  const [budgetWarn, setBudgetWarn] = useState(85);
  const [instName, setInstName] = useState('S.P. College');
  const [instSystemName, setInstSystemName] = useState('College Procurement & Approval Workflow System');
  const [instEmail, setInstEmail] = useState('support@spcollege.edu.in');

  // Stages & Approvers state for admin
  const [adminStages, setAdminStages] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [loadingStages, setLoadingStages] = useState(false);
  const selectedStageCode = 'CDC';
  const [newApproverUserId, setNewApproverUserId] = useState('');
  const [newClassification, setNewClassification] = useState('TEACHING');
  const [assigningApprover, setAssigningApprover] = useState(false);

  // Load configs when admin visits
  const loadAdminConfigs = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingConfig(true);
    setConfigError('');
    try {
      const items = await api('/api/admin/config');
      const map = Object.fromEntries(items.map((i) => [i.key, i.value]));
      if (map['workflow.threshold.principal_max'] !== undefined) setPrincipalMax(Number(map['workflow.threshold.principal_max']));
      if (map['workflow.threshold.cdc_max'] !== undefined) setCdcMax(Number(map['workflow.threshold.cdc_max']));
      if (map['roles.vice_chairman.title'] !== undefined) setVcTitle(String(map['roles.vice_chairman.title']));
      if (map['budget.warn_utilization_percent'] !== undefined) setBudgetWarn(Number(map['budget.warn_utilization_percent']));
      if (map['institution.name'] !== undefined) setInstName(String(map['institution.name']));
      if (map['institution.system_name'] !== undefined) setInstSystemName(String(map['institution.system_name']));
      if (map['institution.support_email'] !== undefined) setInstEmail(String(map['institution.support_email']));
    } catch (err) {
      setConfigError(err.message || 'Failed to load configuration');
    } finally {
      setLoadingConfig(false);
    }
  }, [isAdmin]);

  const loadAdminStagesAndUsers = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingStages(true);
    try {
      const [stgs, usrs] = await Promise.all([
        api('/api/admin/stages'),
        api('/api/admin/users').catch(() => []),
      ]);
      setAdminStages(stgs || []);
      setAllUsers(usrs || []);
    } catch (err) {
      showToast(err.message || 'Failed to load institutional stage approvers', 'error');
    } finally {
      setLoadingStages(false);
    }
  }, [isAdmin, showToast]);

  useEffect(() => {
    if (isAdmin) {
      loadAdminConfigs();
      loadAdminStagesAndUsers();
    }
  }, [isAdmin, loadAdminConfigs, loadAdminStagesAndUsers]);

  const saveThresholds = async (e) => {
    e?.preventDefault();
    setConfigError('');
    if (principalMax <= 0) {
      setConfigError('Principal threshold must be greater than 0');
      return;
    }
    if (principalMax >= cdcMax) {
      setConfigError(`Principal threshold (₹${principalMax}) must be strictly less than CDC threshold (₹${cdcMax})`);
      return;
    }

    setSavingConfig(true);
    try {
      await api('/api/admin/config', {
        method: 'PATCH',
        body: {
          updates: {
            'workflow.threshold.principal_max': Number(principalMax),
            'workflow.threshold.cdc_max': Number(cdcMax),
          },
        },
      });
      showToast('Approval thresholds successfully updated and logged to audit log', 'success');
      stagesApi.reload();
      await loadAdminConfigs();
    } catch (err) {
      setConfigError(err.message || 'Failed to save approval thresholds');
      showToast(err.message, 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const saveFlagsAndMetadata = async (e) => {
    e?.preventDefault();
    setConfigError('');
    setSavingConfig(true);
    try {
      await api('/api/admin/config', {
        method: 'PATCH',
        body: {
          updates: {
            'roles.vice_chairman.title': vcTitle.trim(),
            'budget.warn_utilization_percent': Number(budgetWarn),
            'institution.name': instName.trim(),
            'institution.system_name': instSystemName.trim(),
            'institution.support_email': instEmail.trim(),
          },
        },
      });
      showToast('System configuration saved successfully', 'success');
      await loadAdminConfigs();
    } catch (err) {
      setConfigError(err.message || 'Failed to save system configuration');
      showToast(err.message, 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const assignApprover = async (e) => {
    e?.preventDefault();
    if (!newApproverUserId) {
      showToast('Select an eligible user to assign', 'error');
      return;
    }

    setAssigningApprover(true);
    try {
      const payload = {
        userId: newApproverUserId,
        memberClassification: selectedStageCode === 'CDC' ? newClassification : 'TEACHING',
      };
      await api(`/api/admin/stages/${selectedStageCode}/approvers`, {
        method: 'POST',
        body: payload,
      });
      showToast(`Approver assigned to ${selectedStageCode} stage`, 'success');
      setNewApproverUserId('');
      await loadAdminStagesAndUsers();
    } catch (err) {
      showToast(err.message || 'Failed to assign approver', 'error');
    } finally {
      setAssigningApprover(false);
    }
  };

  const removeApprover = async (stageCode, approverUserId, approverName) => {
    if (!window.confirm(`Are you sure you want to remove ${approverName} from the ${stageCode} approval stage?`)) {
      return;
    }
    try {
      await api(`/api/admin/stages/${stageCode}/approvers/${approverUserId}`, {
        method: 'DELETE',
      });
      showToast(`Removed ${approverName} from ${stageCode}`, 'success');
      await loadAdminStagesAndUsers();
    } catch (err) {
      showToast(err.message || 'Failed to remove approver', 'error');
    }
  };

  // If user is not an admin, render the clean visual route overview
  if (!isAdmin) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
            <Workflow className="w-5 h-5 text-indigo-500" /> Approval route
          </h2>
          <p className="text-xs text-gray-500 mt-1.5 max-w-xl">
            A request enters at the stage whose amount window contains its total. Each stage may approve, partially approve, reject — or escalate to the next stage. The final authority cannot escalate further.
          </p>
        </div>

        <DataState state={stagesApi} isEmpty={stages.length === 0} empty={{ title: 'No stages configured' }}>
          <div className="flex flex-col gap-1">
            {stages.map((s, i) => {
              const c = STAGE_COLORS[i % STAGE_COLORS.length];
              return (
                <div key={s.id}>
                  <div className={`flex items-start gap-4 p-4 rounded-xl border ${c.bg} ${c.border}`}>
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${c.num}`}>
                      {s.sequence}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm ${c.text}`}>{s.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {s.isFinal ? (
                          <span className="flex items-center gap-1">
                            <GitMerge className="w-3 h-3 text-purple-500" /> Final authority — no further escalation possible
                          </span>
                        ) : (
                          'Can approve, partially approve, reject, or escalate to the next stage'
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0 text-xs tabular-nums text-gray-600">
                      {s.entryRange ? (
                        s.entryRange.maxExclusive === null ? (
                          <>
                            <span className="text-gray-400">from </span>
                            <strong>{money(s.entryRange.min)}</strong>
                            <span className="text-gray-400"> and above</span>
                          </>
                        ) : (
                          <>
                            <span className="text-gray-400">from </span>
                            <strong>{money(s.entryRange.min)}</strong>
                            <span className="text-gray-400"> to under </span>
                            <strong>{money(s.entryRange.maxExclusive)}</strong>
                          </>
                        )
                      ) : (
                        <span className="text-gray-400 flex items-center gap-1">
                          <ArrowRight className="w-3 h-3" /> Reached by escalation only
                        </span>
                      )}
                    </div>
                  </div>
                  {i < stages.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ArrowRight className="w-4 h-4 text-gray-300 rotate-90" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>Institutional thresholds and stage approvers are centrally managed by system administrators.</p>
          </div>
        </DataState>
      </div>
    );
  }

  // CDC composition helper calculations
  const cdcStage = adminStages.find((s) => s.code === 'CDC');
  const cdcApprovers = cdcStage?.approvers ?? [];
  const cdcTeachingCount = cdcApprovers.filter((a) => a.memberClassification === 'TEACHING').length;
  const cdcNonTeachingCount = cdcApprovers.filter((a) => a.memberClassification === 'NON_TEACHING').length;

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">System Configuration &amp; Governance</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Authoritative institutional rules, financial thresholds, committee assignments, and operational flags.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { loadAdminConfigs(); loadAdminStagesAndUsers(); }}
            disabled={loadingConfig || loadingStages}
            className="px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConfig || loadingStages ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {configError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{configError}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('rules')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'rules'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <GitMerge className="w-4 h-4" /> Approval Configuration
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('approvers')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'approvers'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Users className="w-4 h-4" /> Stage Approvers &amp; CDC
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('flags')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'flags'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Settings className="w-4 h-4" /> Institution &amp; System Settings
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'preview'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Workflow className="w-4 h-4" /> Live Route Diagram
        </button>
      </div>

      {/* TAB 1: Approval Thresholds */}
      {activeTab === 'rules' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
            <div>
              <h3 className="text-base font-extrabold text-gray-900">Configurable Financial Thresholds</h3>
              <p className="text-xs text-gray-500 mt-1">
                These thresholds govern the workflow engine and Row-Level Security policies. Changes take effect immediately across all subsequent workflow evaluations and are recorded in the audit trail.
              </p>
            </div>

            <form onSubmit={saveThresholds} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="principalMax" className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                      Principal Deciding Authority (Max)
                    </label>
                    <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      Tier 1 Escalation
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-gray-400">₹</span>
                    <input
                      id="principalMax"
                      type="number"
                      min="1"
                      max="10000000"
                      step="1000"
                      value={principalMax}
                      onChange={(e) => setPrincipalMax(Number(e.target.value))}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Requisitions up to this amount can be finally sanctioned or rejected by the Principal. Amounts above this escalate to the College Development Committee.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="cdcMax" className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                      CDC Deciding Authority (Max)
                    </label>
                    <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                      Tier 2 Escalation
                    </span>
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-gray-400">₹</span>
                    <input
                      id="cdcMax"
                      type="number"
                      min="1"
                      max="100000000"
                      step="10000"
                      value={cdcMax}
                      onChange={(e) => setCdcMax(Number(e.target.value))}
                      className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    Requisitions up to this amount are decided by CDC Grant/Non-Grant members. Requisitions above this amount require Chairman &amp; Vice Chairman approval.
                  </p>
                </div>
              </div>

              {/* Dynamic summary preview */}
              <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4 space-y-2">
                <h4 className="text-xs font-extrabold text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600" /> Active Workflow Routing Rules
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                  <div className="bg-white p-3 rounded-lg border border-indigo-100/80 shadow-xs">
                    <span className="font-bold text-gray-700 block">Purchase Committee</span>
                    <span className="text-gray-500 text-[11px]">Under {money(principalMax)}</span>
                    <p className="text-[10px] text-indigo-600 font-medium mt-1">Initial validity check</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-indigo-100/80 shadow-xs">
                    <span className="font-bold text-gray-700 block">Principal Review</span>
                    <span className="text-gray-500 text-[11px]">Decides ≤ {money(principalMax)}</span>
                    <p className="text-[10px] text-indigo-600 font-medium mt-1">Escalates if &gt; {money(principalMax)}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg border border-indigo-100/80 shadow-xs">
                    <span className="font-bold text-gray-700 block">CDC &amp; Chairman</span>
                    <span className="text-gray-500 text-[11px]">CDC up to {money(cdcMax)}</span>
                    <p className="text-[10px] text-purple-600 font-medium mt-1">&gt; {money(cdcMax)} requires Chairman</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50"
                >
                  {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Approval Thresholds
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: Institutional Approvers & CDC */}
      {activeTab === 'approvers' && (
        <div className="space-y-6">
          {/* CDC Committee Composition Card */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" /> College Development Committee (CDC) Composition
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  Enforces statutory institutional capacity: maximum 3 Teaching Faculty and 1 Non-Teaching Staff member.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                  cdcTeachingCount >= 3 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}>
                  Teaching: {cdcTeachingCount} / 3
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                  cdcNonTeachingCount >= 1 ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}>
                  Non-Teaching: {cdcNonTeachingCount} / 1
                </span>
              </div>
            </div>

            {/* List of current CDC members */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">Current Committee Roster</h4>
              {cdcApprovers.length === 0 ? (
                <p className="text-xs text-gray-400 py-3 italic">No approvers currently assigned to CDC.</p>
              ) : (
                <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
                  {cdcApprovers.map((a) => (
                    <div key={a.userId} className="p-3.5 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                          {a.name?.[0] || 'C'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-gray-900">{a.name}</p>
                          <p className="text-[11px] text-gray-400">{a.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 font-semibold">
                          {a.roleName || a.roleCode}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                          a.memberClassification === 'TEACHING'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {a.memberClassification === 'TEACHING' ? 'Teaching Faculty' : 'Non-Teaching Staff'}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeApprover('CDC', a.userId, a.name)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Remove from CDC"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add member form */}
            <form onSubmit={assignApprover} className="p-4 rounded-xl border border-dashed border-gray-300 bg-gray-50/70 space-y-4">
              <h4 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-indigo-600" /> Assign Member to CDC
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="approverUser" className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                    Select User
                  </label>
                  <select
                    id="approverUser"
                    value={newApproverUserId}
                    onChange={(e) => setNewApproverUserId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">-- Choose User --</option>
                    {allUsers
                      .filter((u) => !cdcApprovers.some((ca) => ca.userId === u.id))
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="memberClassification" className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                    Faculty Classification
                  </label>
                  <select
                    id="memberClassification"
                    value={newClassification}
                    onChange={(e) => setNewClassification(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="TEACHING" disabled={cdcTeachingCount >= 3}>
                      Teaching Faculty ({cdcTeachingCount}/3)
                    </option>
                    <option value="NON_TEACHING" disabled={cdcNonTeachingCount >= 1}>
                      Non-Teaching Staff ({cdcNonTeachingCount}/1)
                    </option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={assigningApprover || !newApproverUserId}
                    className="w-full py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    {assigningApprover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />} Assign Approver
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Other Workflow Stages Roster */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
            <h3 className="text-base font-extrabold text-gray-900">Institutional Stage Authorities</h3>
            <div className="space-y-4">
              {adminStages
                .filter((s) => s.code !== 'CDC')
                .map((stg) => (
                  <div key={stg.stageId} className="border border-gray-200 rounded-xl p-4 bg-gray-50/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-extrabold text-gray-900">{stg.name}</h4>
                        <p className="text-[11px] text-gray-500">Stage Code: {stg.code} &bull; Sequence: {stg.sequenceNo}</p>
                      </div>
                      <span className="text-[11px] font-bold text-gray-500 bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                        {stg.approvers?.length || 0} Staffed
                      </span>
                    </div>

                    <div className="divide-y divide-gray-100 bg-white border border-gray-200 rounded-lg overflow-hidden">
                      {stg.approvers?.map((a) => (
                        <div key={a.userId} className="p-3 flex items-center justify-between">
                          <div>
                            <p className="text-xs font-bold text-gray-800">{a.name}</p>
                            <p className="text-[10px] text-gray-400">{a.email}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                              {a.roleName || a.roleCode}
                            </span>
                            {stg.code !== 'PRINCIPAL' || stg.approvers.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => removeApprover(stg.code, a.userId, a.name)}
                                className="p-1 rounded text-gray-400 hover:text-red-600"
                                title="Remove approver"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-gray-400 italic">Mandatory</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: System Flags & Institutional Defaults */}
      {activeTab === 'flags' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6 shadow-sm">
            <div>
              <h3 className="text-base font-extrabold text-gray-900">Institutional Parameters</h3>
              <p className="text-xs text-gray-500 mt-1">
                Configure institutional labels and budget alerting rules. Accounts are created only by invitation from User Management.
              </p>
            </div>

            <form onSubmit={saveFlagsAndMetadata} className="space-y-6">
              {/* Institutional Role Label: Vice Chairman */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="vcTitle" className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Vice Chairman Institutional Title
                  </label>
                  <input
                    id="vcTitle"
                    type="text"
                    required
                    value={vcTitle}
                    onChange={(e) => setVcTitle(e.target.value)}
                    className="w-full px-3.5 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Vice Chairman"
                  />
                  <p className="text-[11px] text-gray-400">Institutional display label applied across stages and approval screens.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="budgetWarn" className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Budget Warning Threshold (%)
                  </label>
                  <input
                    id="budgetWarn"
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={budgetWarn}
                    onChange={(e) => setBudgetWarn(Number(e.target.value))}
                    className="w-full px-3.5 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="85"
                  />
                  <p className="text-[11px] text-gray-400">Departmental allocations exceeding this percentage trigger high-utilization alerts.</p>
                </div>
              </div>

              {/* Institution Metadata */}
              <div className="space-y-4 pt-2 border-t border-gray-100">
                <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Institution Details</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="instName" className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                      College Name
                    </label>
                    <input
                      id="instName"
                      type="text"
                      required
                      value={instName}
                      onChange={(e) => setInstName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="instSystemName" className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                      System Header Title
                    </label>
                    <input
                      id="instSystemName"
                      type="text"
                      required
                      value={instSystemName}
                      onChange={(e) => setInstSystemName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="instEmail" className="block text-[11px] font-semibold text-gray-600 uppercase mb-1">
                      Support Contact Email
                    </label>
                    <input
                      id="instEmail"
                      type="email"
                      required
                      value={instEmail}
                      onChange={(e) => setInstEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-xs transition-colors disabled:opacity-50"
                >
                  {savingConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Flags &amp; Institutional Settings
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 4: Live Workflow Preview */}
      {activeTab === 'preview' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5 shadow-sm">
            <div>
              <h3 className="text-base font-extrabold text-gray-900">Current Institutional Route Overview</h3>
              <p className="text-xs text-gray-500 mt-1">
                Visual demonstration of the approval path as currently evaluated by the PostgreSQL workflow engine.
              </p>
            </div>

            <DataState state={stagesApi} isEmpty={stages.length === 0} empty={{ title: 'No stages configured' }}>
              <div className="flex flex-col gap-1">
                {stages.map((s, i) => {
                  const c = STAGE_COLORS[i % STAGE_COLORS.length];
                  return (
                    <div key={s.id}>
                      <div className={`flex items-start gap-4 p-4 rounded-xl border ${c.bg} ${c.border}`}>
                        <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${c.num}`}>
                          {s.sequence}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`font-bold text-sm ${c.text}`}>{s.name}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {s.isFinal ? (
                              <span className="flex items-center gap-1">
                                <GitMerge className="w-3 h-3 text-purple-500" /> Final authority — no further escalation possible
                              </span>
                            ) : (
                              'Can approve, partially approve, reject, or escalate to the next stage'
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0 text-xs tabular-nums text-gray-600">
                          {s.entryRange ? (
                            s.entryRange.maxExclusive === null ? (
                              <>
                                <span className="text-gray-400">from </span>
                                <strong>{money(s.entryRange.min)}</strong>
                                <span className="text-gray-400"> and above</span>
                              </>
                            ) : (
                              <>
                                <span className="text-gray-400">from </span>
                                <strong>{money(s.entryRange.min)}</strong>
                                <span className="text-gray-400"> to under </span>
                                <strong>{money(s.entryRange.maxExclusive)}</strong>
                              </>
                            )
                          ) : (
                            <span className="text-gray-400 flex items-center gap-1">
                              <ArrowRight className="w-3 h-3" /> Reached by escalation only
                            </span>
                          )}
                        </div>
                      </div>
                      {i < stages.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowRight className="w-4 h-4 text-gray-300 rotate-90" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </DataState>
          </div>
        </div>
      )}
    </div>
  );
};
