import React, { useState, useId } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Edit3,
  HelpCircle,
  Loader2,
  Lock,
  Shield,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { validateRequestRules, STATUS } from '../validation/requestRules';
import { loadLocalModel, isLocalAiFeatureEnabled } from '../ai/localModel';
import { analyzeRequestText, SUGGESTION_TYPES } from '../ai/requestWritingAssistant';

/**
 * Reusable ProcureFlow Smart Check Component.
 *
 * Integrates:
 * 1. Deterministic validation (authoritative, gates submission).
 * 2. Optional browser-local AI writing assistant (advisory only, runs 100% on device).
 */
export const LocalAiAssistant = ({
  request = {},
  onApplySuggestion,
  existingRequests = [],
  className = '',
}) => {
  const liveRegionId = useId();
  const [hasRunAi, setHasRunAi] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [aiResults, setAiResults] = useState(null);
  const [ignoredIds, setIgnoredIds] = useState(new Set());
  const [appliedIds, setAppliedIds] = useState(new Set());
  const [showDeterministicDetails, setShowDeterministicDetails] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(null); // { id, type, text }

  // 1. Authoritative Deterministic Validation (Always Active)
  const validation = validateRequestRules(request);

  // Check if feature flag is active
  const aiFeatureAvailable = isLocalAiFeatureEnabled();

  const handleRunAi = async () => {
    setAiLoading(true);
    setAiError(null);
    setLoadingProgress('Initializing on-device AI runtime...');

    try {
      let pipelineInstance = null;
      try {
        pipelineInstance = await loadLocalModel((p) => {
          if (p?.status === 'progress' && p?.progress !== undefined) {
            setLoadingProgress(`Loading model weights: ${Math.round(p.progress)}%`);
          } else if (p?.status) {
            setLoadingProgress(`Status: ${p.status}`);
          }
        });
      } catch (loadErr) {
        // Fall back gracefully to browser-local heuristic engine
        console.warn('[Smart Check] Model download or WebGPU unavailable, using local rule assistant:', loadErr.message);
      }

      setLoadingProgress('Analyzing request clarity and completeness...');
      const results = await analyzeRequestText(request, {
        existingRequests,
        localPipeline: pipelineInstance,
      });

      setAiResults(results);
      setHasRunAi(true);
    } catch (err) {
      setAiError(err.message || 'Browser-local AI check encountered an unexpected error.');
    } finally {
      setAiLoading(false);
      setLoadingProgress(null);
    }
  };

  const handleApply = (suggestionId, suggestion) => {
    setPendingConfirm({ id: suggestionId, suggestion });
  };

  const confirmApply = () => {
    if (!pendingConfirm || !onApplySuggestion) return;
    const { id, suggestion } = pendingConfirm;

    let targetField = '';
    if (suggestion.type === SUGGESTION_TYPES.TITLE) targetField = 'title';
    if (suggestion.type === SUGGESTION_TYPES.JUSTIFICATION) targetField = 'description';
    if (suggestion.type === SUGGESTION_TYPES.ITEM_SPECIFICATION) targetField = 'itemRemark';
    if (suggestion.type === SUGGESTION_TYPES.SUMMARY) targetField = 'summary';

    onApplySuggestion(targetField, suggestion.suggestedText);
    setAppliedIds((prev) => new Set([...prev, id]));
    setPendingConfirm(null);
  };

  const handleIgnore = (suggestionId) => {
    setIgnoredIds((prev) => new Set([...prev, suggestionId]));
  };

  const activeSuggestions = (aiResults?.suggestions || [])
    .map((s, idx) => ({ ...s, id: `sug-${idx}` }))
    .filter((s) => !ignoredIds.has(s.id));

  return (
    <section
      role="region"
      aria-label="ProcureFlow Smart Check"
      className={`rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 space-y-4 shadow-xs ${className}`}
    >
      {/* Screen reader live updates */}
      <div id={liveRegionId} className="sr-only" aria-live="polite">
        {aiLoading ? loadingProgress : ''}
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              ProcureFlow Smart Check
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                Authoritative Validation &amp; Advisory AI
              </span>
            </h3>
            <p className="text-xs text-gray-500">
              Deterministic institutional checks and privacy-preserving local writing advice.
            </p>
          </div>
        </div>

        {/* Status badge */}
        <div>
          {validation.status === STATUS.COMPLETE && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" /> Ready for submission
            </span>
          )}
          {validation.status === STATUS.NEEDS_CLARIFICATION && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5" /> Needs clarification
            </span>
          )}
          {validation.status === STATUS.NEEDS_CORRECTION && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
              <XCircle className="w-3.5 h-3.5" /> Needs correction
            </span>
          )}
        </div>
      </div>

      {/* 1. Deterministic Validation Checks (Always Shown) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            Institutional Rule Compliance
            <span className="text-[10px] text-gray-400 font-normal">
              ({validation.deterministicChecks.filter((c) => c.passed).length}/{validation.deterministicChecks.length} passed)
            </span>
          </span>
          <button
            type="button"
            onClick={() => setShowDeterministicDetails((v) => !v)}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 cursor-pointer"
            aria-expanded={showDeterministicDetails}
          >
            {showDeterministicDetails ? 'Hide details' : 'Show details'}
            {showDeterministicDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* High-priority errors if any */}
        {validation.errors.length > 0 && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
            <p className="text-xs font-bold text-rose-800 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Submission Blocked by Institutional Rules:
            </p>
            <ul className="text-xs text-rose-700 list-disc pl-5 space-y-0.5">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings if any */}
        {validation.warnings.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
            <p className="text-xs font-bold text-amber-800 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Recommended Clarifications:
            </p>
            <ul className="text-xs text-amber-700 list-disc pl-5 space-y-0.5">
              {validation.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Detailed checks list */}
        {showDeterministicDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {validation.deterministicChecks.map((check) => (
              <div
                key={check.code}
                className={`p-2 rounded-lg border text-xs flex items-start gap-2 ${
                  check.passed
                    ? 'bg-gray-50/50 border-gray-200 text-gray-700'
                    : 'bg-rose-50/50 border-rose-200 text-rose-800 font-medium'
                }`}
              >
                {check.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
                )}
                <span className="leading-snug">{check.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Optional Browser-Local AI Assistant */}
      <div className="pt-2 border-t border-gray-100 space-y-3">
        {!aiFeatureAvailable ? (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-between text-xs text-gray-500">
            <span>Optional Local AI Assistant is disabled in this environment configuration.</span>
            <span className="text-[10px] uppercase font-semibold text-gray-400">Deterministic check active</span>
          </div>
        ) : (
          <>
            {/* Explanation card before first run */}
            {!hasRunAi && !aiLoading && (
              <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-xl flex items-start gap-3">
                <Lock className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-indigo-950 font-medium leading-relaxed">
                    This optional check runs locally in your browser. Your request text is not sent to an external AI provider.
                  </p>
                  <p className="text-[11px] text-indigo-700/80">
                    Runs on-device via WebGPU / WebAssembly. Evaluates clarity, specification completeness, and wording quality.
                  </p>
                </div>
              </div>
            )}

            {/* Run Button / Progress */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">AI Assistance:</span> Advisory only · No effect on approval routing or thresholds.
              </div>

              <button
                type="button"
                onClick={handleRunAi}
                disabled={aiLoading}
                aria-label="Run local browser AI check"
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold flex items-center gap-2 shadow-2xs transition-all disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing locally...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{hasRunAi ? 'Re-run Local AI Check' : 'Run Local AI Check'}</span>
                  </>
                )}
              </button>
            </div>

            {/* Loading status */}
            {aiLoading && loadingProgress && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-600 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-600 animate-pulse" />
                <span>{loadingProgress}</span>
              </div>
            )}

            {/* AI Error Fallback State */}
            {aiError && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Local AI Inference Notice
                </p>
                <p>{aiError}</p>
                <p className="text-[11px] text-amber-700">
                  Standard rule-based checking remains fully functional. You can proceed with your submission normally.
                </p>
              </div>
            )}

            {/* AI Results */}
            {hasRunAi && !aiLoading && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    Suggestions for Improvement ({activeSuggestions.length})
                  </span>
                  <span className="text-[10px] text-gray-400">
                    Engine: {aiResults?.modelName || 'On-device'}
                  </span>
                </div>

                {activeSuggestions.length === 0 ? (
                  <div className="p-4 bg-emerald-50/60 border border-emerald-100 rounded-xl text-xs text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Your request text is well-detailed and clear. No additional wording improvements suggested.</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {activeSuggestions.map((sug) => {
                      const isApplied = appliedIds.has(sug.id);
                      return (
                        <div
                          key={sug.id}
                          className="p-3.5 rounded-xl border border-gray-200 bg-white hover:border-indigo-200 transition-colors space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-gray-900 uppercase tracking-wider text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                              {sug.type}
                            </span>
                            <span className="text-[10px] text-gray-500 font-medium">
                              Advisory confidence: {Math.round(sug.confidence * 100)}%
                            </span>
                          </div>

                          <p className="text-gray-700 leading-relaxed">{sug.message}</p>

                          {/* Suggested text preview */}
                          <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-800 font-mono text-[11px] whitespace-pre-wrap select-all">
                            {sug.suggestedText}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleIgnore(sug.id)}
                              className="px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 cursor-pointer"
                            >
                              Ignore
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApply(sug.id, sug)}
                              disabled={isApplied}
                              className={`px-3 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                                isApplied
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-white border border-gray-200 hover:border-indigo-300 text-indigo-600 hover:bg-indigo-50/50 shadow-2xs'
                              }`}
                            >
                              {isApplied ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>Applied</span>
                                </>
                              ) : (
                                <>
                                  <Edit3 className="w-3 h-3" />
                                  <span>Apply suggestion</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Disclaimer */}
                <p className="text-[10px] text-gray-400 italic leading-relaxed pt-1">
                  {aiResults?.disclaimer}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal for Applying Suggestions */}
      {pendingConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-apply-title"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-xl border border-gray-200">
            <h4 id="confirm-apply-title" className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600" />
              Apply Suggested Text?
            </h4>
            <p className="text-xs text-gray-600 leading-relaxed">
              This will update the {pendingConfirm.suggestion.type.toLowerCase().replace('_', ' ')} field. You can continue editing the field manually at any time.
            </p>
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-mono text-gray-800 whitespace-pre-wrap max-h-36 overflow-y-auto">
              {pendingConfirm.suggestion.suggestedText}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApply}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer shadow-2xs"
              >
                Confirm &amp; Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
