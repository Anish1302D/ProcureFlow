import React, { useState } from 'react';
import { CheckCircle2, CornerUpLeft, Scissors, Send, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { money, quantity } from '../../api/format';
import { useAction } from '../../hooks/useApi';
import { parseCustomItem } from '../../utils/customItem';

// Persistent (unselected) styles give approvers an immediate visual cue
// of what each button does BEFORE they click. Selected styles are bolder.
const CHOICES = {
  APPROVE: {
    label: 'Approve',
    icon: CheckCircle2,
    // Unselected: soft green ghost; Selected: solid green
    idle: 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300',
    active: 'bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 shadow-emerald-200 shadow-md',
    dot: 'bg-emerald-500',
    done: 'Request approved',
  },
  PARTIAL_APPROVE: {
    label: 'Partial approve',
    icon: Scissors,
    idle: 'bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 hover:border-teal-300',
    active: 'bg-teal-600 hover:bg-teal-700 text-white border border-teal-600 shadow-teal-200 shadow-md',
    dot: 'bg-teal-500',
    done: 'Partial approval recorded',
  },
  REJECT: {
    label: 'Reject',
    icon: XCircle,
    idle: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 hover:border-red-300',
    active: 'bg-red-600 hover:bg-red-700 text-white border border-red-600 shadow-red-200 shadow-md',
    dot: 'bg-red-500',
    done: 'Request rejected',
  },
  ESCALATE: {
    label: 'Escalate',
    icon: Send,
    idle: 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300',
    active: 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600 shadow-indigo-200 shadow-md',
    dot: 'bg-indigo-500',
    done: 'Escalated to the next authority',
  },
  RETURN: {
    label: 'Send back for correction',
    icon: CornerUpLeft,
    idle: 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 hover:border-amber-300',
    active: 'bg-amber-600 hover:bg-amber-700 text-white border border-amber-600 shadow-amber-200 shadow-md',
    dot: 'bg-amber-500',
    done: 'Sent back to the requester for correction',
  },
};

function escalateLabel(stageCode, amount, fundingType) {
  if (stageCode === 'PURCHASE_COMMITTEE') return 'Verify & Refer to Principal';
  if (stageCode === 'PRINCIPAL') {
    if (amount <= 500000) {
      return fundingType === 'NON_GRANT' ? 'Review & Refer to CDC (Non-Grant)' : 'Review & Refer to CDC (Grant)';
    }
    return 'Review & Refer to Chairman & Vice Chairman';
  }
  return 'Refer to Next Stage';
}

const STAGE_NOTE = {
  PURCHASE_COMMITTEE: 'The Purchase Committee verifies request completeness and compliance. '
    + 'It cannot make final purchase approvals — refer to the Principal for mandatory review and routing.',
  PRINCIPAL: 'Every purchase request reaches the Principal stage. For amounts up to ₹50,000, Principal is the final approving authority. '
    + 'For amounts above ₹50,000, this is a mandatory review stage — review details and forward to CDC (up to ₹5,00,000) or Chairman & Vice Chairman (above ₹5,00,000).',
  CDC: 'You are reviewing this request as the authorized CDC approver for this department\'s funding partition. CDC approval finalizes requests between ₹50,000 and ₹5,00,000.',
  FINAL_AUTHORITY: 'You are reviewing this request as the Chairman authority stage. Authorized Chairman or Vice Chairman decision completes requests exceeding ₹5,00,000.',
};

// Whole paise, so the preview total adds up the way the server's NUMERIC does.
const paise = (value) => Math.round(Number(value) * 100);

/**
 * What an approver can do with a request at their stage. The options come from
 * the server (`permissions.actions`); the server checks authority again when
 * the decision is sent, so nothing here grants anything.
 */
export const DecisionPanel = ({ request }) => {
  const { run, busy } = useAction();
  const [action, setAction] = useState(null);
  const [comments, setComments] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState(() =>
    Object.fromEntries(request.items.map((i) => [i.id, { qty: String(i.requestedQuantity), amount: '' }])));

  const setLine = (id, patch) => setLines((l) => ({ ...l, [id]: { ...l[id], ...patch } }));

  // Approved amount for a line: the typed override, else quantity x unit cost.
  const lineAmount = (item) => {
    const line = lines[item.id];
    if (line.amount !== '') return paise(line.amount);
    return Math.round(paise(line.qty) * paise(item.unitCost) / 100);
  };

  const preview = action === 'PARTIAL_APPROVE'
    ? request.items.reduce((sum, i) => sum + lineAmount(i), 0) / 100
    : null;

  const label = (code) =>
    (code === 'ESCALATE' ? escalateLabel(request.stage.code, Number(request.tentativeTotalCost), request.fundingType || request.department?.fundingType) : CHOICES[code].label);

  const problems = [];
  if (action === 'REJECT' && reason.trim().length < 3) problems.push('Give a reason for rejecting.');
  if (action === 'RETURN' && comments.trim().length < 3) {
    problems.push('Say what needs correcting — it is all the requester will see.');
  }
  if (action === 'PARTIAL_APPROVE') {
    for (const i of request.items) {
      const { displayName } = parseCustomItem(i.budgetItem, i.remarks);
      const qty = Number(lines[i.id].qty);
      if (lines[i.id].qty === '' || Number.isNaN(qty) || qty < 0 || qty > i.requestedQuantity) {
        problems.push(`${displayName}: approve between 0 and ${quantity(i.requestedQuantity)}.`);
      } else if (lineAmount(i) > paise(i.estimatedTotal)) {
        problems.push(`${displayName}: the amount can't exceed ${money(i.estimatedTotal)}.`);
      } else if (qty === 0 && lineAmount(i) > 0) {
        problems.push(`${displayName}: an item left out (quantity 0) can't carry an amount.`);
      }
    }
  }

  const submit = async () => {
    const body = { action, comments: comments.trim() || undefined };
    if (action === 'REJECT') body.rejectionReason = reason.trim();
    if (action === 'PARTIAL_APPROVE') {
      body.itemDecisions = request.items.map((i) => ({
        requestItemId: i.id,
        approvedQuantity: Number(lines[i.id].qty),
        ...(lines[i.id].amount !== '' ? { approvedAmount: Number(lines[i.id].amount) } : {}),
      }));
    }
    const { ok } = await run(
      () => api(`/api/requests/${request.id}/actions`, { method: 'POST', body }),
      CHOICES[action].done,
    );
    if (ok) setAction(null);
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-4">
      <div>
        <h4 className="text-xs font-bold text-gray-900">Your decision — {request.stage.name}</h4>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {STAGE_NOTE[request.stage.code]
            ?? (request.stage.isFinal
              ? 'This is the final stage; there is no further escalation.'
              : 'Escalating sends the request to the next authority.')}
        </p>
        {request.jointApprovals?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {request.jointApprovals.map((a) => (
              <span key={a.roleCode}
                className={`px-2 py-1 rounded-lg text-[10px] font-semibold border ${
                  a.decided
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-white text-gray-500 border-gray-200'
                }`}>
                {a.roleName}: {a.decided ? `recorded${a.by ? ` — ${a.by.name}` : ''}` : 'still to decide'}
              </span>
            ))}
            <span className="text-[10px] text-gray-500 self-center">
              Both are required; either may go first.
            </span>
          </div>
        )}
      </div>

      {/* Action picker — each button is persistently color-coded */}
      <div className="flex flex-wrap gap-2">
        {request.permissions.actions.map((code) => {
          const c = CHOICES[code];
          const Icon = c.icon;
          const selected = action === code;
          return (
            <button
              key={code}
              onClick={() => setAction(selected ? null : code)}
              aria-pressed={selected}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all duration-150 ${
                selected ? c.active : c.idle
              }`}
            >
              {/* Persistent color dot when unselected so meaning is clear */}
              {!selected && <span className={`w-2 h-2 rounded-full ${c.dot} shrink-0`} />}
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {label(code)}
            </button>
          );
        })}
      </div>

      {action === 'PARTIAL_APPROVE' && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-2 px-3">Item</th>
                <th className="py-2 px-3 text-right">Requested</th>
                <th className="py-2 px-3">Approve qty</th>
                <th className="py-2 px-3">Amount (optional)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {request.items.map((i) => {
                const { displayName } = parseCustomItem(i.budgetItem, i.remarks);
                return (
                  <tr key={i.id}>
                    <td className="py-2 px-3 font-semibold text-gray-800">{displayName}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500">{quantity(i.requestedQuantity)} × {money(i.unitCost)}</td>
                    <td className="py-2 px-3 w-32">
                      <input type="number" min="0" max={i.requestedQuantity} step="0.01" aria-label={`Approved quantity for ${displayName}`}
                        className={inputCls} value={lines[i.id].qty} onChange={(e) => setLine(i.id, { qty: e.target.value })} />
                    </td>
                    <td className="py-2 px-3 w-40">
                      <input type="number" min="0" step="0.01" aria-label={`Approved amount for ${displayName}`}
                        placeholder={money(lineAmount(i) / 100)} className={inputCls}
                        value={lines[i.id].amount} onChange={(e) => setLine(i.id, { amount: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">
            Set a quantity to 0 to leave that item out. Leave the amount blank to use quantity × unit cost, or enter a lower agreed price.
            <span className="float-right font-semibold text-gray-800">Sanctioning {money(preview)} of {money(request.tentativeTotalCost)}</span>
          </p>
        </div>
      )}

      {action === 'REJECT' && (
        <textarea rows={2} className={inputCls} placeholder="Reason for rejecting (required, shown to the requester)"
          value={reason} onChange={(e) => setReason(e.target.value)} />
      )}

      {action && (
        <>
          <textarea rows={2} className={inputCls}
            placeholder={action === 'RETURN'
              ? 'What needs correcting? (required — this is what the requester is shown)'
              : 'Remarks (optional)'}
            value={comments} onChange={(e) => setComments(e.target.value)} />
          {problems.length > 0 && (
            <ul className="text-[11px] text-red-600 list-disc pl-4 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => setAction(null)} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">Cancel</button>
            <button onClick={submit} disabled={busy || problems.length > 0}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${CHOICES[action].active}`}>
              {busy ? 'Recording…' : `Confirm: ${label(action).toLowerCase()}`}
            </button>
          </div>
          <p className="text-[10px] text-gray-400">Your decision is recorded with your name and sealed in the request's history.</p>
        </>
      )}
    </div>
  );
};
