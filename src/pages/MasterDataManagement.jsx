import React, { useState } from 'react';
import {
  BookOpen, Building2, ChevronDown, ChevronRight, Edit2,
  GraduationCap, Loader2, Plus, Trash2, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useApi, useAction } from '../hooks/useApi';

// ---------------------------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------------------------

function FormModal({ title, onClose, onSave, saving, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">{children}</div>
        <div className="px-6 pb-5 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button onClick={onSave} disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

// ---------------------------------------------------------------------------
// Department section
// ---------------------------------------------------------------------------

function DeptModal({ dept, onClose, onSaved }) {
  const { showToast } = useApp();
  const [form, setForm] = useState({
    code: dept?.code ?? '',
    name: dept?.name ?? '',
    fundingType: dept?.fundingType ?? 'GRANT',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.code.trim()) return showToast('Code is required', 'error');
    if (!form.name.trim()) return showToast('Name is required', 'error');
    setSaving(true);
    try {
      if (dept) {
        await api(`/api/admin/departments/${dept.id}`, {
          method: 'PATCH',
          body: {
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            fundingType: form.fundingType,
          },
        });
        showToast(`${form.name} updated`, 'success');
      } else {
        await api('/api/admin/departments', {
          method: 'POST',
          body: {
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            fundingType: form.fundingType,
          },
        });
        showToast(`${form.name} added`, 'success');
      }
      onSaved();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={dept ? 'Edit department' : 'Add department'} onClose={onClose} onSave={save} saving={saving}>
      <div>
        <label className={labelCls}>Code * (e.g. CS)</label>
        <input className={inputCls} placeholder="CS" maxLength={20}
          value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
        <p className="text-[10px] text-gray-400 mt-1">Short uppercase identifier — letters, numbers and hyphens only.</p>
      </div>
      <div>
        <label className={labelCls}>Full name *</label>
        <input className={inputCls} placeholder="e.g. Computer Science"
          value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Funding Type *</label>
        <select
          className={inputCls}
          value={form.fundingType}
          onChange={(e) => setForm((f) => ({ ...f, fundingType: e.target.value }))}
        >
          <option value="GRANT">Grant (Government / State Aid)</option>
          <option value="NON_GRANT">Non-Grant (Self-Financed)</option>
        </select>
        <p className="text-[10px] text-gray-400 mt-1">
          Determines whether requests from this department are reviewed by CDC Grant Member or CDC Non-Grant Member.
        </p>
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Course section
// ---------------------------------------------------------------------------

function CourseModal({ course, departments, deptId, onClose, onSaved }) {
  const { showToast } = useApp();
  const [form, setForm] = useState({
    departmentId: course?.departmentId ?? deptId ?? (departments[0]?.id ?? ''),
    code: course?.code ?? '',
    name: course?.name ?? '',
    fundingType: course?.fundingType ?? 'GRANT',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.code.trim()) return showToast('Code is required', 'error');
    if (!form.name.trim()) return showToast('Name is required', 'error');
    if (!form.departmentId) return showToast('Select a department', 'error');
    setSaving(true);
    try {
      const fields = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        fundingType: form.fundingType,
      };
      if (course) {
        await api(`/api/admin/courses/${course.id}`, { method: 'PATCH', body: fields });
        showToast(`${form.name} updated`, 'success');
      } else {
        await api('/api/admin/courses', { method: 'POST', body: { departmentId: Number(form.departmentId), ...fields } });
        showToast(`${form.name} added`, 'success');
      }
      onSaved();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <FormModal title={course ? 'Edit course' : 'Add course'} onClose={onClose} onSave={save} saving={saving}>
      {!course && (
        <div>
          <label className={labelCls}>Department *</label>
          <select className={inputCls} value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">Choose…</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className={labelCls}>Code * (e.g. BCA)</label>
        <input className={inputCls} placeholder="BCA" maxLength={30}
          value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} />
      </div>
      <div>
        <label className={labelCls}>Full name *</label>
        <input className={inputCls} placeholder="e.g. Bachelor of Computer Applications"
          value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className={labelCls}>Funding *</label>
        <select className={inputCls} value={form.fundingType}
          onChange={(e) => setForm((f) => ({ ...f, fundingType: e.target.value }))}>
          <option value="GRANT">Grant (aided)</option>
          <option value="NON_GRANT">Non-Grant (unaided)</option>
        </select>
        <p className="text-[10px] text-gray-400 mt-1">
          Decides which CDC member — Grant or Non-Grant — this course's requests belong to.
        </p>
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const MasterDataManagement = () => {
  const { refresh } = useApp();
  const { run } = useAction();
  const depts = useApi('/api/admin/departments');
  const courses = useApi('/api/admin/courses');
  const [expanded, setExpanded] = useState({});
  const [modal, setModal] = useState(null); // { kind, item?, deptId? }

  const closeModal = () => { setModal(null); refresh(); };

  const deleteDept = async (dept) => {
    if (!window.confirm(`Delete department "${dept.name}"? Only empty departments with no associated courses or requests can be deleted.`)) return;
    await run(() => api(`/api/admin/departments/${dept.id}`, { method: 'DELETE' }), `${dept.name} deleted`);
  };

  const deleteCourse = async (course) => {
    if (!window.confirm(`Delete course "${course.name}"?`)) return;
    await run(() => api(`/api/admin/courses/${course.id}`, { method: 'DELETE' }), `${course.name} deleted`);
  };

  const deptList = depts.data ?? [];
  const courseList = courses.data ?? [];
  const coursesByDept = (deptId) => courseList.filter((c) => c.departmentId === deptId);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 uppercase tracking-widest flex items-center gap-1.5 w-fit">
              <BookOpen className="w-3 h-3" /> Master data
            </span>
            <h2 className="text-xl font-extrabold text-gray-900 mt-1">Departments & Courses</h2>
            <p className="text-xs text-gray-500 mt-0.5">Add departments and the courses within them. Changes appear immediately in the request form.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setModal({ kind: 'dept' })}
              className="px-4 py-2 rounded-lg bg-white border border-emerald-300 text-emerald-800 text-xs font-bold flex items-center gap-1.5 hover:bg-emerald-50">
              <Plus className="w-4 h-4" /> Department
            </button>
            <button onClick={() => setModal({ kind: 'course' })}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Course
            </button>
          </div>
        </div>

        {/* Departments accordion */}
        {depts.loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
            {deptList.length === 0 && (
              <p className="text-center py-12 text-sm text-gray-400">No departments yet. Add one above.</p>
            )}
            {deptList.map((dept) => {
              const open = expanded[dept.id];
              const deptCourses = coursesByDept(dept.id);
              return (
                <div key={dept.id}>
                  {/* Department row */}
                  <div className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/50 transition-colors">
                    <button onClick={() => setExpanded((e) => ({ ...e, [dept.id]: !open }))}
                      className="text-gray-400 hover:text-indigo-600 transition-colors">
                      {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <Building2 className="w-4 h-4 text-indigo-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                        {dept.name}
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                          dept.fundingType === 'NON_GRANT'
                            ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : 'bg-sky-50 text-sky-700 border border-sky-200'
                        }`}>
                          {dept.fundingType === 'NON_GRANT' ? 'Non-Grant' : 'Grant'}
                        </span>
                      </p>
                      <p className="text-[11px] text-gray-400 font-mono">{dept.code} · {dept.courseCount} course{dept.courseCount !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setModal({ kind: 'course', deptId: dept.id })} title="Add course to this department"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 text-[10px] flex items-center gap-1">
                        <Plus className="w-3 h-3" /> <GraduationCap className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setModal({ kind: 'dept', item: dept })} title="Edit"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteDept(dept)} title="Delete"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Courses */}
                  {open && (
                    <div className="bg-gray-50/40 border-t border-gray-100">
                      {deptCourses.length === 0 ? (
                        <p className="px-12 py-4 text-xs text-gray-400 italic">No courses yet —
                          <button onClick={() => setModal({ kind: 'course', deptId: dept.id })} className="ml-1 text-indigo-600 font-semibold hover:underline">add one</button>.
                        </p>
                      ) : (
                        deptCourses.map((course) => (
                          <div key={course.id} className="flex items-center gap-3 px-12 py-2.5 border-b border-gray-100 last:border-0 hover:bg-white/60 transition-colors">
                            <GraduationCap className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800 font-medium flex items-center gap-2">
                                {course.name}
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                                  course.fundingType === 'NON_GRANT'
                                    ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                    : 'bg-sky-50 text-sky-700 border border-sky-200'
                                }`}>
                                  {course.fundingType === 'NON_GRANT' ? 'Non-Grant' : 'Grant'}
                                </span>
                              </p>
                              <p className="text-[10px] text-gray-400 font-mono">{course.code}</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => setModal({ kind: 'course', item: course })} title="Edit"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50">
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button onClick={() => deleteCourse(course)} title="Delete"
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.kind === 'dept' && (
        <DeptModal dept={modal.item ?? null} onClose={() => setModal(null)} onSaved={closeModal} />
      )}
      {modal?.kind === 'course' && (
        <CourseModal
          course={modal.item ?? null}
          departments={deptList}
          deptId={modal.deptId ?? null}
          onClose={() => setModal(null)}
          onSaved={closeModal}
        />
      )}
    </>
  );
};
