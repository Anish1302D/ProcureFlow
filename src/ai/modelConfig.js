/**
 * Configuration and metadata for the ProcureFlow Browser-Local AI Model.
 *
 * All operations execute strictly on-device inside the user's browser via WebGPU / WebAssembly.
 * Uses the high-capacity all-mpnet-base-v2 model (~438 MB, 768 dimensions) for state-of-the-art
 * semantic understanding, with automatic fallback to all-MiniLM-L6-v2 (~23 MB) on constrained devices.
 * No request data is ever transmitted to an external service or cloud provider.
 */

export const LOCAL_AI_MODEL_CONFIG = Object.freeze({
  name: 'Xenova/all-mpnet-base-v2',
  fallbackName: 'Xenova/all-MiniLM-L6-v2',
  task: 'feature-extraction',
  version: '2.0.0',
  license: 'Apache-2.0',
  sourceUrl: 'https://huggingface.co/Xenova/all-mpnet-base-v2',
  description: 'High-capacity 768-dimensional transformer model for on-device semantic evaluation and request assistance.',
  sizeApproxMb: 438,
  quantized: false, // High-precision float32 model (~438 MB)
  fallbackQuantized: true, // Lightweight fallback (~23 MB)
  deviceOptions: ['webgpu', 'wasm', 'cpu'],
  engineName: 'ProcureFlow Smart Check Local Engine (MPNet-v2)',
});

export const DISCLAIMER_TEXT =
  'AI-generated suggestions are advisory only and do not constitute approval, rejection, financial advice, policy interpretation, or an official institutional decision.';
