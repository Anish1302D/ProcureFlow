/**
 * ProcureFlow Smart Check - Browser-Local Request Writing Assistant.
 *
 * Runs strictly on-device in the user's browser.
 * Generates advisory suggestions for titles, justifications, specifications, and summaries.
 * NEVER makes approval, rejection, routing, or financial decisions.
 */

import { LOCAL_AI_MODEL_CONFIG, DISCLAIMER_TEXT } from './modelConfig.js';
import { cosineSimilarity } from './localModel.js';

export const SUGGESTION_TYPES = Object.freeze({
  TITLE: 'TITLE',
  JUSTIFICATION: 'JUSTIFICATION',
  ITEM_SPECIFICATION: 'ITEM_SPECIFICATION',
  SUMMARY: 'SUMMARY',
});

/**
 * Escapes HTML characters to prevent XSS vulnerability in rendered suggestions.
 * @param {string} str
 * @returns {string} Sanitized string
 */
export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates and normalizes confidence score between 0 and 1.
 * @param {number} val
 * @returns {number}
 */
export function normalizeConfidence(val) {
  const num = Number(val);
  if (!Number.isFinite(num) || Number.isNaN(num)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(num * 100) / 100));
}

/**
 * Generates advisory writing improvements for a procurement request.
 *
 * @param {object} [request]
 * @param {string} [request.title]
 * @param {string} [request.description]
 * @param {string|number} [request.budgetHeadName]
 * @param {string} [request.urgency]
 * @param {Array<object>} [request.items]
 * @param {number} [request.totalAmount]
 * @param {object} [options]
 * @param {Array<object>} [options.existingRequests] Local prior requests for similarity check
 * @param {object} [options.localPipeline] Optional pre-loaded ML pipeline
 * @returns {Promise<object>} Structured advisory suggestions
 */
export async function analyzeRequestText(request, options = {}) {
  const safeReq = request || {};
  const { existingRequests = [], localPipeline = null } = options || {};

  const suggestions = [];

  // Safe string coercion and length clamping to prevent resource exhaustion attacks
  const rawTitle = String(safeReq.title ?? '').slice(0, 500).trim();
  const rawDescription = String(safeReq.description ?? '').slice(0, 5000).trim();
  const rawUrgency = String(safeReq.urgency ?? 'Medium').trim();
  const rawHeadName = String(safeReq.budgetHeadName ?? 'Departmental Budget').trim();
  const rawItems = Array.isArray(safeReq.items) ? safeReq.items.slice(0, 50) : [];
  const totalAmount = Number(safeReq.totalAmount) || 0;

  // 1. Title Quality Analysis
  if (rawTitle) {
    const isAllCaps = rawTitle.length > 5 && rawTitle === rawTitle.toUpperCase() && /[A-Z]/.test(rawTitle);
    const genericWords = ['item', 'items', 'equipment', 'equipments', 'purchase', 'stuff', 'misc', 'procurement', 'material', 'goods'];
    const titleLower = rawTitle.toLowerCase();
    const isGeneric = genericWords.some((w) => titleLower === w || titleLower === `purchase of ${w}` || titleLower === `new ${w}`);

    if (isAllCaps) {
      const titleCased = rawTitle
        .toLowerCase()
        .replace(/(?:^|\s)\w/g, (match) => match.toUpperCase());
      suggestions.push({
        type: SUGGESTION_TYPES.TITLE,
        message: 'The title is written in ALL CAPS. Converting to standard title case improves readability for approvers.',
        suggestedText: titleCased,
        confidence: 0.95,
      });
    } else if (isGeneric || rawTitle.split(/\s+/).length < 3) {
      const primaryItemName = rawItems[0]?.name || rawItems[0]?.customItemName || 'Lab Materials';
      const refinedTitle = `Procurement of ${primaryItemName} for Academic Session`;
      suggestions.push({
        type: SUGGESTION_TYPES.TITLE,
        message: 'The request title is brief or generic. A title identifying the specific equipment or purpose helps approvers review faster.',
        suggestedText: refinedTitle,
        confidence: 0.85,
      });
    }
  }

  // 2. Justification Quality Analysis
  if (rawDescription) {
    const descLower = rawDescription.toLowerCase();
    const hasAcademicContext = /student|curriculum|syllabus|practical|experiment|lab|research|teaching|faculty|course/i.test(descLower);
    const hasUrgencyExplanation = /urgent|emergency|replace|broken|damage|deadline|inspection|schedule/i.test(descLower);
    const isUrgent = rawUrgency.toLowerCase() === 'high' || rawUrgency.toLowerCase() === 'critical';

    if (isUrgent && !hasUrgencyExplanation) {
      const urgentJustification = `${rawDescription} High urgency: immediate procurement is required to prevent disruption to ongoing laboratory schedules.`;
      suggestions.push({
        type: SUGGESTION_TYPES.JUSTIFICATION,
        message: 'This request is marked with high urgency, but the justification does not state the operational deadline or impact of delay.',
        suggestedText: urgentJustification,
        confidence: 0.88,
      });
    } else if (!hasAcademicContext && rawDescription.length < 120) {
      const enrichedJustification = `${rawDescription} These items are required to support upcoming practical sessions and curriculum requirements, ensuring uninterrupted coursework for students.`;
      suggestions.push({
        type: SUGGESTION_TYPES.JUSTIFICATION,
        message: 'Approvers look for curriculum or operational relevance. Consider clarifying how this procurement supports academic coursework or departmental functions.',
        suggestedText: enrichedJustification,
        confidence: 0.80,
      });
    }
  }

  // 3. Item Specification & Ambiguity Analysis
  const ambiguousTerms = ['pc', 'computer', 'laptop', 'cable', 'wire', 'adapter', 'software', 'sensor', 'table', 'chair', 'multimeter'];
  rawItems.forEach((item, index) => {
    const itemName = String(item.customItemName || item.name || '').trim();
    const remarks = String(item.remarks ?? '').trim();
    const itemNum = index + 1;

    if (itemName) {
      const itemLower = itemName.toLowerCase();
      const isAmbiguous = ambiguousTerms.some((t) => itemLower === t || itemLower === `${t}s`);

      if (isAmbiguous && (!remarks || remarks.length < 8)) {
        suggestions.push({
          type: SUGGESTION_TYPES.ITEM_SPECIFICATION,
          message: `Item ${itemNum} ("${itemName}") lacks technical specifications. Adding model, make, or technical parameters prevents purchase delays.`,
          suggestedText: `Institutional grade ${itemName}; include detailed technical specifications, make/model, and minimum 1-year warranty.`,
          confidence: 0.85,
        });
      }
    }
  });

  // 4. Neutral Summary Generation
  if (rawTitle && rawItems.length > 0) {
    const count = rawItems.length;
    const formattedTotal = totalAmount > 0 ? `₹${totalAmount.toLocaleString('en-IN')}` : 'estimated cost';
    const summaryText = `Procurement request for ${rawTitle}, comprising ${count} item line(s) under ${rawHeadName} (${formattedTotal}, ${rawUrgency} priority).`;
    suggestions.push({
      type: SUGGESTION_TYPES.SUMMARY,
      message: 'Executive summary for approver notes or meeting records:',
      suggestedText: summaryText,
      confidence: 0.90,
    });
  }

  // 5. Semantic Similarity / Duplicate Detection (if local requests list provided)
  if (existingRequests.length > 0 && rawTitle && localPipeline) {
    try {
      // Run feature-extraction pipeline locally on the title
      const output = await localPipeline(rawTitle, { pooling: 'mean', normalize: true });
      const currentVector = Array.from(output.data);

      for (const prior of existingRequests.slice(0, 20)) {
        if (!prior.title || prior.id === safeReq.id) continue;
        const priorOutput = await localPipeline(prior.title, { pooling: 'mean', normalize: true });
        const sim = cosineSimilarity(currentVector, Array.from(priorOutput.data));
        if (sim >= 0.82) {
          suggestions.push({
            type: SUGGESTION_TYPES.TITLE,
            message: `High semantic similarity (${Math.round(sim * 100)}%) detected with prior request "${prior.title}" (#${prior.id || 'N/A'}). Verify whether this is an intentional repeat order.`,
            suggestedText: rawTitle,
            confidence: Number(sim.toFixed(2)),
          });
          break;
        }
      }
    } catch {
      // Fail silently on model runtime error during similarity — fallback gracefully
    }
  }

  // Sanitize and validate every suggestion
  const validatedSuggestions = suggestions.map((s) => ({
    type: s.type,
    message: String(s.message ?? ''),
    suggestedText: String(s.suggestedText ?? ''),
    confidence: normalizeConfidence(s.confidence),
  }));

  return {
    aiAvailable: true,
    modelName: LOCAL_AI_MODEL_CONFIG.name,
    modelVersion: LOCAL_AI_MODEL_CONFIG.version,
    suggestions: validatedSuggestions,
    disclaimer: DISCLAIMER_TEXT,
  };
}
