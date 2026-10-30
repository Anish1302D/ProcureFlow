/**
 * ProcureFlow Smart Check - Browser-Local Request Writing Assistant.
 *
 * Runs strictly on-device in the user's browser.
 * Generates accurate, context-aware suggestions for titles, justifications, specifications, and summaries.
 * Employs deep institutional domain knowledge and semantic evaluation.
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
 * Capitalizes string words to Title Case.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|-)\w/g, (match) => match.toUpperCase());
}

/**
 * Generates contextual specifications template based on item terminology.
 * @param {string} itemName
 * @returns {string}
 */
function getSpecificationTemplate(itemName) {
  const lower = itemName.toLowerCase();
  if (/computer|desktop|pc|workstation/i.test(lower)) {
    return 'Intel Core i5/i7 (13th Gen+) or AMD Ryzen 5/7; 16GB DDR5 RAM; 512GB NVMe SSD; 24" FHD IPS Monitor; OEM USB Keyboard & Mouse; Windows 11 Pro; 3-Year Onsite Warranty.';
  }
  if (/laptop|notebook/i.test(lower)) {
    return '14"-15.6" FHD IPS Display; Intel Core i5/Ryzen 5; 16GB RAM; 512GB SSD; Wi-Fi 6; Backlit Keyboard; OEM Carry Bag; 3-Year Onsite Institutional Warranty.';
  }
  if (/printer|scanner|copier|mfd/i.test(lower)) {
    return 'Network Multifunction Laser Printer (Print/Scan/Copy); Automatic 2-sided duplex; ADF scanner; 30+ ppm; Ethernet & Wi-Fi; 1-Year Onsite Warranty.';
  }
  if (/projector|display|screen/i.test(lower)) {
    return 'Full HD (1920x1080) native resolution; 4,000+ ANSI Lumens; HDMI 2.0 & VGA inputs; Ceiling mount bracket kit with remote; 2-Year Warranty.';
  }
  if (/chair|table|desk|furniture|cupboard|almirah/i.test(lower)) {
    return 'Heavy-duty institutional grade; ergonomic adjustable mechanism; scratch-resistant powder-coated steel/solid wood frame; 1-Year commercial warranty.';
  }
  if (/cable|wire|switch|router|adapter/i.test(lower)) {
    return 'Cat6 UTP / Gigabit standard; shielded connector clips; certified OEM standard with minimum 1-year product replacement warranty.';
  }
  return `Institutional grade ${itemName}; include detailed technical specifications, make/model number, and minimum 1-year onsite warranty.`;
}

/**
 * Generates advisory writing improvements for a procurement request.
 *
 * @param {object} [request]
 * @param {string} [request.title]
 * @param {string} [request.description]
 * @param {string} [request.departmentName]
 * @param {string} [request.courseName]
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
  const rawDeptName = String(safeReq.departmentName ?? '').trim();
  const rawCourseName = String(safeReq.courseName ?? '').trim();
  const rawItems = Array.isArray(safeReq.items) ? safeReq.items.slice(0, 50) : [];
  const totalAmount = Number(safeReq.totalAmount) || 0;

  // Format department suffix if available
  const cleanDept = rawDeptName ? rawDeptName.replace(/^Department of\s+/i, '') : '';
  const deptSuffix = cleanDept ? ` for Department of ${cleanDept}` : '';

  // 1. Title Quality Analysis
  if (rawTitle) {
    const isAllCaps = rawTitle.length > 5 && rawTitle === rawTitle.toUpperCase() && /[A-Z]/.test(rawTitle);
    const genericWords = [
      'item', 'items', 'equipment', 'equipments', 'purchase', 'stuff', 'misc',
      'procurement', 'material', 'goods', 'computer', 'computers', 'pc', 'laptop',
      'laptops', 'printer', 'printers', 'projector', 'projectors', 'stationery',
      'furniture', 'books', 'chemicals', 'tools'
    ];
    const titleLower = rawTitle.toLowerCase();
    const isSingleGeneric = genericWords.some((w) => titleLower === w || titleLower === `purchase of ${w}` || titleLower === `new ${w}`);
    const words = rawTitle.split(/\s+/);

    if (isAllCaps) {
      const titleCased = toTitleCase(rawTitle);
      suggestions.push({
        type: SUGGESTION_TYPES.TITLE,
        message: 'The title is written in ALL CAPS. Converting to standard title case improves readability for approvers.',
        suggestedText: titleCased,
        confidence: 0.95,
      });
    } else if (isSingleGeneric || words.length < 3) {
      let refinedTitle = '';
      if (titleLower.includes('computer') || titleLower === 'pc') {
        refinedTitle = `Procurement of Desktop Computers${deptSuffix || ' for Academic Labs'}`;
      } else if (titleLower.includes('laptop')) {
        refinedTitle = `Procurement of Laptops for Academic & Faculty Use${deptSuffix}`;
      } else if (titleLower.includes('printer')) {
        refinedTitle = `Procurement of Network Laser Printers${deptSuffix}`;
      } else if (titleLower.includes('projector')) {
        refinedTitle = `Procurement of Multimedia Projectors for Classrooms${deptSuffix}`;
      } else if (titleLower.includes('furniture') || titleLower.includes('chair') || titleLower.includes('table')) {
        refinedTitle = `Procurement of Institutional Furniture & Seating${deptSuffix}`;
      } else if (titleLower.includes('book')) {
        refinedTitle = `Procurement of Reference Books & Course Materials${deptSuffix}`;
      } else if (rawItems.length > 0 && (rawItems[0].name || rawItems[0].customItemName)) {
        const itemPrimary = rawItems[0].name || rawItems[0].customItemName;
        refinedTitle = `Procurement of ${toTitleCase(itemPrimary)}${deptSuffix}`;
      } else {
        refinedTitle = `Procurement of ${toTitleCase(rawTitle)}${deptSuffix}`;
      }

      suggestions.push({
        type: SUGGESTION_TYPES.TITLE,
        message: `The title "${rawTitle}" is brief or generic. Specifying the exact equipment and purpose helps approvers review faster.`,
        suggestedText: refinedTitle,
        confidence: 0.90,
      });
    }
  }

  // 2. Justification Quality Analysis
  const isUrgent = rawUrgency.toLowerCase() === 'high' || rawUrgency.toLowerCase() === 'critical';
  if (rawDescription) {
    const descLower = rawDescription.toLowerCase();
    const hasAcademicContext = /student|curriculum|syllabus|practical|experiment|lab|research|teaching|faculty|course|department|academic/i.test(descLower);
    const hasUrgencyExplanation = /urgent|emergency|replace|broken|damage|deadline|inspection|schedule|exam|audit/i.test(descLower);

    if (isUrgent && !hasUrgencyExplanation) {
      const urgentJustification = `${rawDescription} High urgency: immediate procurement is required to prevent disruption to scheduled academic sessions and practical coursework.`;
      suggestions.push({
        type: SUGGESTION_TYPES.JUSTIFICATION,
        message: 'This request is marked with high urgency, but the justification does not state the operational deadline or impact of delay.',
        suggestedText: urgentJustification,
        confidence: 0.88,
      });
    } else if (!hasAcademicContext && rawDescription.length < 120) {
      const enrichedJustification = `${rawDescription} These items are required to support upcoming curriculum coursework and practical sessions${deptSuffix}, ensuring uninterrupted educational delivery.`;
      suggestions.push({
        type: SUGGESTION_TYPES.JUSTIFICATION,
        message: 'Approvers look for curriculum or operational relevance. Clarifying how this procurement supports academic coursework improves approval speed.',
        suggestedText: enrichedJustification,
        confidence: 0.82,
      });
    }
  } else if (rawTitle) {
    // If justification is completely empty, offer a well-structured draft
    const targetDept = cleanDept ? `Department of ${cleanDept}` : 'department';
    const draftJustification = `Required by ${targetDept} to support curriculum requirements, student practical sessions, and departmental operations. The requested items ensure uninterrupted academic activities and meet current institutional standards.`;
    suggestions.push({
      type: SUGGESTION_TYPES.JUSTIFICATION,
      message: 'No justification provided. Providing a clear operational purpose and academic context helps approvers evaluate institutional necessity.',
      suggestedText: draftJustification,
      confidence: 0.85,
    });
  }

  // 3. Item Specification & Ambiguity Analysis
  const ambiguousTerms = [
    'pc', 'computer', 'laptop', 'cable', 'wire', 'adapter', 'software',
    'sensor', 'table', 'chair', 'multimeter', 'printer', 'scanner', 'projector',
    'display', 'switch', 'router', 'chemicals', 'microscope'
  ];

  rawItems.forEach((item, index) => {
    const itemName = String(item.customItemName || item.name || '').trim();
    const remarks = String(item.remarks ?? '').trim();
    const itemNum = index + 1;

    if (itemName) {
      const itemLower = itemName.toLowerCase();
      const isAmbiguous = ambiguousTerms.some((t) => itemLower === t || itemLower === `${t}s` || itemLower.includes(t));

      // Ambiguous if item lacks technical parameters or remarks is under 15 characters
      if (isAmbiguous && (!remarks || remarks.length < 15)) {
        const specTemplate = getSpecificationTemplate(itemName);
        suggestions.push({
          type: SUGGESTION_TYPES.ITEM_SPECIFICATION,
          message: `Item ${itemNum} ("${itemName}") lacks technical specifications. Adding make, model, or technical parameters prevents purchase delays and vendor confusion.`,
          suggestedText: specTemplate,
          confidence: 0.88,
        });
      }
    }
  });

  // 4. Executive Neutral Summary Generation (if request has title and at least one item)
  if (rawTitle && rawItems.length > 0) {
    const count = rawItems.length;
    const formattedTotal = totalAmount > 0 ? `₹${totalAmount.toLocaleString('en-IN')}` : 'estimated cost';
    const courseNote = rawCourseName ? ` (${rawCourseName})` : '';
    const summaryText = `Procurement request for ${rawTitle}${courseNote}, comprising ${count} item line(s) under ${rawHeadName} (${formattedTotal}, ${rawUrgency} priority).`;
    suggestions.push({
      type: SUGGESTION_TYPES.SUMMARY,
      message: 'Executive summary for approver notes or meeting records:',
      suggestedText: summaryText,
      confidence: 0.90,
    });
  }

  // 5. Semantic Similarity / Duplicate Detection (if local requests list provided and pipeline available)
  if (existingRequests.length > 0 && rawTitle && localPipeline) {
    try {
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
      // Non-blocking
    }
  }

  // Sanitize and normalize suggestions
  const sanitizedSuggestions = suggestions.map((s, idx) => ({
    id: `ai-sug-${idx}-${s.type.toLowerCase()}`,
    type: s.type,
    message: sanitizeText(s.message),
    suggestedText: sanitizeText(s.suggestedText),
    confidence: normalizeConfidence(s.confidence),
  }));

  return {
    aiAvailable: true,
    modelName: LOCAL_AI_MODEL_CONFIG.name,
    modelVersion: LOCAL_AI_MODEL_CONFIG.version,
    suggestions: sanitizedSuggestions,
    disclaimer: DISCLAIMER_TEXT,
  };
}
