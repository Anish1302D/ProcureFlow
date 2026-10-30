/**
 * Configuration and metadata for the ProcureFlow Browser-Local AI Model.
 *
 * All operations execute strictly on-device inside the user's browser via WebGPU / WebAssembly.
 * No request data is ever transmitted to an external service or cloud provider.
 */

export const LOCAL_AI_MODEL_CONFIG = Object.freeze({
  name: 'Xenova/all-MiniLM-L6-v2',
  task: 'feature-extraction',
  version: '1.0.0',
  license: 'Apache-2.0',
  sourceUrl: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2',
  description: 'Quantized sentence-level embedding and similarity model running purely in-browser.',
  sizeApproxMb: 23,
  quantized: true,
  deviceOptions: ['webgpu', 'wasm', 'cpu'],
  engineName: 'ProcureFlow Smart Check Local Engine',
});

export const DISCLAIMER_TEXT =
  'AI-generated suggestions are advisory only and do not constitute approval, rejection, financial advice, policy interpretation, or an official institutional decision.';
