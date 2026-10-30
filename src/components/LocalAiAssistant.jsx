import React, { useState, useEffect, useId } from 'react';
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
 *    Auto-rechecks debounced after initial run; manual re-run button kept for confirmation.
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
        pipelineInstance = await loadLocalModel((progressStr) => {
          setLoadingProgress(progressStr);
        });
      } catch (loadErr) {
        // Fall back gracefully to browser-local rule assistant
        console.warn('[Smart Check] Model download or WebGPU unavailable, using local rule assistant:', loadErr.message);
      }

      setLoadingProgress('Evaluating request quality and domain context...');
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

  // Automatic background re-check once AI has been run at least once
  useEffect(() => {
    if (!hasRunAi || aiLoading) return;

    const timer = setTimeout(async () => {
      try {
        const pipelineInstance = await loadLocalModel().catch(() => null);
        const results = await analyzeRequestText(request, {
          existingRequests,
          localPipeline: pipelineInstance,
        });
        setAiResults(results);
      } catch {
        // Background check failed non-fatally; preserve existing suggestions
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [
    hasRunAi,
    request.title,
    request.description,
    request.urgency,
    request.budgetHeadId,
    request.budgetHeadName,
    request.departmentName,
    request.courseName,
    request.items,
    request.totalAmount,
  ]);

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

      {/* 1. Authoritative Deterministic Rules Summary */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span className="font-semibold text-gray-800">
            Institutional Rule Compliance
            <span className="ml-1.5 font-normal text-gray-500">
              ({validation.deterministicChecks.filter((c) => c.passed).length}/{validation.deterministicChecks.length} passed)
            </span>
          </span>

          <button
            type="button"
            onClick={() => setShowDeterministicDetails((v) => !v)}
            aria-expanded={showDeterministicDetails}
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
          >
            {showDeterministicDetails ? 'Hide details' : 'Show details'}
            {showDeterministicDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Blocking Errors Banner */}
        {validation.errors.length > 0 && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Submission Blocked by Institutional Rules:</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-rose-800">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings Banner */}
        {validation.warnings.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Recommended Clarifications:</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5 text-amber-800">
              {validation.warnings.map((warn, i) => (
                <li key={i}>{warn}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Expandable Deterministic Checks List */}
        {showDeterministicDetails && (
          <div className="mt-2 space-y-1.5 rounded-xl bg-gray-50 p-3 border border-gray-200 text-xs">
            {validation.deterministicChecks.map((check) => (
              <div key={check.code} className="flex items-start gap-2 text-gray-700">
                {check.passed ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                ) : check.severity === 'WARNING' ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />
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
                <span className="font-semibold text-gray-700">AI Assistance:</span> Advisory only · Auto-updates as you type.
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
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/70 text-emerald-950 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1 rounded-lg bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-900">
                          Request Writing Quality Verified
                        </span>
                      </div>
                      <span className="text-[10px] uppercase font-semibold px-2.5 py-0.5 rounded-full bg-emerald-200/80 text-emerald-800">
                        Ready for review
                      </span>
                    </div>
                    <p className="text-xs text-emerald-800 leading-relaxed">
                      Everything is correct and well-specified. Your title is clear, the justification outlines institutional need, and item specifications are properly defined.
                    </p>
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
                                  <CheckCircle2 className="w-3 h-3" />
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

                {/* Statutory Disclaimer */}
                <p className="text-[11px] text-gray-400 italic pt-1">
                  {aiResults?.disclaimer}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Confirmation Modal */}
      {pendingConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl border border-gray-200 space-y-4">
            <div className="flex items-center gap-2.5 text-indigo-700">
              <Shield className="w-5 h-5 shrink-0" />
              <h4 id="confirm-modal-title" className="text-sm font-bold text-gray-900">
                Confirm Applying Suggestion
              </h4>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed">
              This will update your request field with the suggested text below. You can continue editing manually afterwards:
            </p>

            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200 font-mono text-xs text-gray-800 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {pendingConfirm.suggestion.suggestedText}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmApply}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer"
              >
                Apply to request
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
