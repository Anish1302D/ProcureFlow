/**
 * Browser-Local AI Model loader and inference manager.
 *
 * Runs strictly client-side on WebGPU / WebAssembly via Transformers.js.
 * Zero network transmission of request text.
 * Cached in memory to prevent duplicate downloads.
 */

import { LOCAL_AI_MODEL_CONFIG } from './modelConfig.js';

let cachedPipeline = null;
let activeLoadPromise = null;
let modelStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let lastError = null;

/**
 * Checks whether the environment supports local AI execution.
 * @returns {boolean}
 */
export function isLocalAiFeatureEnabled() {
  // Respect VITE_LOCAL_AI_ENABLED flag
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.VITE_LOCAL_AI_ENABLED === 'true';
  }
  return false;
}

/**
 * Detects device hardware acceleration capability.
 * @returns {Promise<'webgpu'|'wasm'|'cpu'>}
 */
export async function detectHardwareBackend() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      // Fall through to wasm
    }
  }
  return 'wasm';
}

/**
 * Lazy loads and caches the browser-local model.
 * Multiple concurrent callers receive the same promise to prevent duplicate downloads.
 *
 * @param {Function} [onProgress] Callback receiving progress updates { status, progress }
 * @returns {Promise<object>} The loaded pipeline instance
 */
export async function loadLocalModel(onProgress) {
  if (cachedPipeline) {
    return cachedPipeline;
  }

  if (activeLoadPromise) {
    return activeLoadPromise;
  }

  modelStatus = 'loading';
  lastError = null;

  activeLoadPromise = (async () => {
    try {
      // Dynamic import to prevent initial bundle bloat
      const transformersModule = await import('@xenova/transformers');
      const { pipeline, env } = transformersModule;

      // Configure purely browser-local caching and disable node filesystem attempts
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
      }

      const backend = await detectHardwareBackend();

      const pipe = await pipeline(
        LOCAL_AI_MODEL_CONFIG.task,
        LOCAL_AI_MODEL_CONFIG.name,
        {
          quantized: LOCAL_AI_MODEL_CONFIG.quantized,
          device: backend === 'webgpu' ? 'webgpu' : 'wasm',
          progress_callback: (progressData) => {
            if (onProgress && typeof onProgress === 'function') {
              onProgress(progressData);
            }
          },
        }
      );

      cachedPipeline = pipe;
      modelStatus = 'ready';
      return pipe;
    } catch (err) {
      modelStatus = 'error';
      lastError = err;
      throw new Error(
        `Local AI model could not be loaded on this device: ${err.message || 'Incompatible browser environment or offline.'}`
      );
    } finally {
      activeLoadPromise = null;
    }
  })();

  return activeLoadPromise;
}

/**
 * Returns current model status.
 */
export function getModelStatus() {
  return {
    status: modelStatus,
    isLoaded: Boolean(cachedPipeline),
    error: lastError ? lastError.message : null,
    config: LOCAL_AI_MODEL_CONFIG,
  };
}

/**
 * Resets cached model state (for testing and error recovery).
 */
export function resetModelState() {
  cachedPipeline = null;
  activeLoadPromise = null;
  modelStatus = 'unloaded';
  lastError = null;
}

/**
 * In-memory Cosine Similarity between two float vectors.
 * @param {number[]|Float32Array} a
 * @param {number[]|Float32Array} b
 * @returns {number} Value in range [-1, 1]
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

