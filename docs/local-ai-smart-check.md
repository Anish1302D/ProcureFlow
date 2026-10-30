# ProcureFlow Smart Check: Browser-Local AI & Deterministic Validation

## Overview

**ProcureFlow Smart Check** is a privacy-first, on-device validation and writing assistance system designed for educational institution procurement workflows. It combines:

1. **Deterministic Rule Engine (`src/validation/requestRules.js`):** Authoritative validation that strictly enforces institutional procurement policies, arithmetic integrity, required attachments, and duplicate detection.
2. **Browser-Local AI Assistant (`src/ai/requestWritingAssistant.js`):** An optional, advisory-only language quality assistant running 100% on-device inside the user's browser using WebGPU or WebAssembly.

---

## Key Guarantees & Privacy Principles

- **Zero External Transmission:** Request titles, justifications, specifications, and financial numbers are **never** transmitted to OpenAI, Gemini, Anthropic, or any cloud API.
- **No API Keys:** The feature requires no paid subscription, accounts, or cloud API credentials.
- **Authoritative Determinism:** AI output is **strictly advisory**. AI cannot approve, reject, sanction, route, or modify procurement requests. Institutional approval rules remain absolute.
- **User Agency:** AI suggestions are never applied automatically or silently. Suggestions can be applied only upon explicit user confirmation, edited manually, or completely ignored.
- **Fail-Safe Operation:** If the device cannot run local AI, deterministic validation continues to function without interruption.

---

## Architecture & Data Flow

```
+--------------------------------------------------------------------------------+
|                               USER'S BROWSER                                  |
|                                                                                |
|  [ProcureFlow Request Form]                                                    |
|           |                                                                    |
|           +---> (1) Deterministic Validation Engine (Always Active)            |
|           |         * Authoritatively validates required fields, math & docs   |
|           |         * Blocks submission if institutional errors exist          |
|           |                                                                    |
|           +---> (2) "Run Local AI Check" Button (Optional User Action)         |
|                     |                                                          |
|                     v                                                          |
|         [Transformers.js / ONNX Runtime Web]                                   |
|         * Lazy-loaded in-memory                                                |
|         * WebGPU Acceleration (with WebAssembly CPU Fallback)                  |
|         * Model: Xenova/all-MiniLM-L6-v2 (Quantized ONNX)                      |
|                     |                                                          |
|                     v                                                          |
|         [Local Advisory Suggestions]                                           |
|         * Title Case & Clarity                                                 |
|         * Specification Completeness                                           |
|         * Justification Context                                                |
|         * Executive Summary                                                    |
|                     |                                                          |
|                     +---> User Confirms -> Updates field in React state        |
|                     +---> User Ignores  -> Original text kept 100% untouched   |
+--------------------------------------------------------------------------------+
                                       |
                       NO NETWORK REQUESTS (0 BYTES SENT)
                                       v
                             [External AI Providers]
```

---

## Model Specifications & Licensing

| Parameter | Specification |
|---|---|
| **Model Name** | `Xenova/all-MiniLM-L6-v2` |
| **Model Task** | Feature Extraction / Semantic Text Representation |
| **Model Version** | `1.0.0` |
| **License** | **Apache 2.0** (Permissive open source) |
| **Download Source** | [Hugging Face Hub (`Xenova/all-MiniLM-L6-v2`)](https://huggingface.co/Xenova/all-MiniLM-L6-v2) |
| **Model Size** | ~23 MB (Quantized `q8` ONNX weights) |
| **Inference Hardware** | WebGPU (Primary) with WebAssembly / CPU (Fallback) |

---

## Hardware & Browser Requirements

1. **Modern Browser:** Chrome/Chromium 113+, Edge 113+, Firefox 120+, or Safari 17+.
2. **Hardware Acceleration:**
   - Devices with WebGPU support automatically execute inference on the local GPU.
   - Devices lacking WebGPU fall back to WebAssembly (WASM) multithreading or CPU SIMD.
3. **Bandwidth:** The ~23 MB quantized model weights are downloaded **only once** upon the user's first explicit click on *"Run Local AI Check"*, and cached in the browser's persistent IndexedDB/CacheStorage.

---

## Configuration & Feature Flags

The local AI feature is controlled via an environment variable in `.env`:

```env
# Enable browser-local AI assistance (default: false or missing)
VITE_LOCAL_AI_ENABLED=true
```

- **`VITE_LOCAL_AI_ENABLED=false` (or missing):** Hides the optional local AI check button. The authoritative deterministic rule engine remains fully active.
- **`VITE_LOCAL_AI_ENABLED=true`:** Enables the *"Run Local AI Check"* button.

---

## Why AI Cannot Make Approval Decisions

1. **Institutional Governance:** S.P. College procurement decisions involve public funds, statutory quotas, and institutional financial accountability. Approval decisions must follow documented authority matrices (Purchase Committee, Principal, CDC, Chairman).
2. **Audit Trails & Seals:** Approvals in ProcureFlow generate cryptographic seals signed with `SIGNING_SECRET` and logged in PostgreSQL audit tables. Machine learning models cannot bear administrative accountability.
3. **Hallucination Prevention:** Probabilistic models cannot be trusted to verify budget arithmetic or legal eligibility.

---

## How to Replace or Update the Model

To point to another quantized model or update configuration:
1. Open `src/ai/modelConfig.js`.
2. Update `LOCAL_AI_MODEL_CONFIG.name`, `sizeApproxMb`, and `task`.
3. Ensure the model has an ONNX export compatible with Transformers.js and a permissive commercial license (e.g., Apache 2.0 or MIT).

---

## Known Limitations

- **First-time Download Latency:** On slow connections, the initial 23 MB download may take a few seconds. A progress indicator informs the user. Subsequent runs use the cached weights instantly.
- **Device Memory Constraints:** Extremely low-end mobile devices with less than 2 GB RAM may experience slower WebAssembly inference. In such cases, the fallback heuristic engine guarantees suggestions without model overhead.
