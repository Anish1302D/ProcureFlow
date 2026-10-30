import React from 'react';
import { Trash2 } from 'lucide-react';
import { money, quantity } from '../../api/format';
import { StatusBadge } from '../ui/StatusBadge';

import { parseCustomItem } from '../../utils/customItem';

/**
 * Line items with requested, approved and unapproved figures side by side —
 * the original request is never overwritten, so all three are always shown
 * once a decision exists.
 */
export const ItemsTable = ({ items, decided, onRemove }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200">
    <table className="w-full text-left text-xs bg-white">
      <thead>
        <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[10px] bg-gray-50/60">
          <th className="py-2.5 px-3">Item</th>
          <th className="py-2.5 px-3 text-right">Qty</th>
          <th className="py-2.5 px-3 text-right">Unit cost</th>
          <th className="py-2.5 px-3 text-right">Requested</th>
          {decided && <th className="py-2.5 px-3 text-right">Approved</th>}
          {decided && <th className="py-2.5 px-3 text-right">Not approved</th>}
          {decided && <th className="py-2.5 px-3">Decision</th>}
          {onRemove && <th className="py-2.5 px-3" aria-label="Remove" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {items.map((i) => {
          const { displayName, displayRemarks } = parseCustomItem(i.budgetItem, i.remarks);
          return (
            <tr key={i.id}>
              <td className="py-2.5 px-3">
                <p className="font-semibold text-gray-800">{displayName}</p>
                <p className="text-[10px] text-gray-400 capitalize">{i.itemType.toLowerCase()}{displayRemarks ? ` · ${displayRemarks}` : ''}</p>
              </td>
              <td className="py-2.5 px-3 text-right tabular-nums">{quantity(i.requestedQuantity)} {i.budgetItem.unit ?? ''}</td>
              <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">{money(i.unitCost)}</td>
              <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-gray-900">{money(i.estimatedTotal)}</td>
              {decided && (
                <td className="py-2.5 px-3 text-right tabular-nums">
                  <span className="font-semibold text-emerald-700">{money(i.approvedAmount)}</span>
                  <span className="block text-[10px] text-gray-400">{quantity(i.approvedQuantity)} of {quantity(i.requestedQuantity)}</span>
                </td>
              )}
              {decided && (
                <td className="py-2.5 px-3 text-right tabular-nums text-gray-500">
                  {money(Math.round((i.estimatedTotal - i.approvedAmount) * 100) / 100)}
                  <span className="block text-[10px] text-gray-400">{quantity(i.unapprovedQuantity)} units</span>
                </td>
              )}
              {decided && <td className="py-2.5 px-3"><StatusBadge status={i.status} kind="item" /></td>}
              {onRemove && (
                <td className="py-2.5 px-3 text-right">
                  <button onClick={() => onRemove(i)} aria-label={`Remove ${displayName}`} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
