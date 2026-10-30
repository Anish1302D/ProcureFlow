/**
 * Browser-Local AI Model loader and inference manager.
 *
 * Runs strictly client-side on WebGPU / WebAssembly via Transformers.js.
 * Zero network transmission of request text.
 * Cached in memory to prevent duplicate downloads.
 * Uses high-capacity all-mpnet-base-v2 (~438 MB) with fallback to all-MiniLM-L6-v2 (~23 MB).
 */

import { LOCAL_AI_MODEL_CONFIG } from './modelConfig.js';

let cachedPipeline = null;
let activeLoadPromise = null;
let modelStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let lastError = null;
let activeModelName = LOCAL_AI_MODEL_CONFIG.name;

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
      // Fallback
    }
  }
  if (typeof WebAssembly !== 'undefined') {
    return 'wasm';
  }
  return 'cpu';
}

/**
 * Lazy loads the browser-local transformer model with concurrency locking and caching.
 * Attempts high-capacity MPNet (~438 MB) first; seamlessly falls back to MiniLM (~23 MB) if memory/network limits require.
 *
 * @param {Function} [onProgress] Callback receiving human-readable loading progress
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

      const progressBridge = (progressData) => {
        if (!onProgress || typeof onProgress !== 'function') return;

        if (progressData && typeof progressData === 'object') {
          if (progressData.status === 'progress' && progressData.total) {
            const pct = Math.round((progressData.loaded / progressData.total) * 100);
            const loadedMb = (progressData.loaded / (1024 * 1024)).toFixed(1);
            const totalMb = (progressData.total / (1024 * 1024)).toFixed(1);
            onProgress(`Loading neural weights: ${pct}% (${loadedMb}MB / ${totalMb}MB)...`);
            return;
          }
          if (progressData.status === 'initiate') {
            onProgress(`Initializing model file: ${progressData.file || 'weights'}...`);
            return;
          }
          if (progressData.status === 'done') {
            onProgress('Weights loaded into browser memory. Initializing runtime...');
            return;
          }
        }
        if (typeof progressData === 'string') {
          onProgress(progressData);
        }
      };

      let pipe = null;
      try {
        if (onProgress) onProgress(`Connecting to local engine (${LOCAL_AI_MODEL_CONFIG.name})...`);
        pipe = await pipeline(
          LOCAL_AI_MODEL_CONFIG.task,
          LOCAL_AI_MODEL_CONFIG.name,
          {
            quantized: LOCAL_AI_MODEL_CONFIG.quantized,
            device: backend === 'webgpu' ? 'webgpu' : 'wasm',
            progress_callback: progressBridge,
          }
        );
        activeModelName = LOCAL_AI_MODEL_CONFIG.name;
      } catch (primaryErr) {
        // If high-capacity model fails (e.g. low memory or connection timeout during download),
        // gracefully attempt the lightweight fallback
        if (LOCAL_AI_MODEL_CONFIG.fallbackName) {
          if (onProgress) onProgress(`Switching to compact model (${LOCAL_AI_MODEL_CONFIG.fallbackName})...`);
          pipe = await pipeline(
            LOCAL_AI_MODEL_CONFIG.task,
            LOCAL_AI_MODEL_CONFIG.fallbackName,
            {
              quantized: LOCAL_AI_MODEL_CONFIG.fallbackQuantized,
              device: backend === 'webgpu' ? 'webgpu' : 'wasm',
              progress_callback: progressBridge,
            }
          );
          activeModelName = LOCAL_AI_MODEL_CONFIG.fallbackName;
        } else {
          throw primaryErr;
        }
      }

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
    activeModelName,
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
  activeModelName = LOCAL_AI_MODEL_CONFIG.name;
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
