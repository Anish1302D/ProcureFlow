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
- **Continuous Auto-Assistance:** Once initiated by clicking *"Run Local AI Check"*, subsequent edits to the form trigger debounced background checks automatically. The manual *"Re-run Local AI Check"* button remains available for on-demand confirmation.
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
|           +---> (2) "Run Local AI Check" Button (Initial User Trigger)         |
|                     |                                                          |
|                     v                                                          |
|         [Transformers.js / ONNX Runtime Web]                                   |
|         * Lazy-loaded in-memory                                                |
|         * WebGPU Acceleration (with WebAssembly CPU Fallback)                  |
|         * Primary Model: Xenova/all-mpnet-base-v2 (~438 MB, 768 dimensions)    |
|         * Fallback Model: Xenova/all-MiniLM-L6-v2 (~23 MB)                     |
|                     |                                                          |
|                     v                                                          |
|         [Local Advisory Evaluation & Suggestions]                              |
|         * Context-Aware Title Expansion (e.g. "computers" -> Department title) |
|         * Detailed Hardware/Institutional Specifications                       |
|         * Justification Completeness & Urgency Impact                          |
|         * "Quality Verified" state when all text meets institutional standards |
|                     |                                                          |
|                     +---> User Confirms -> Updates field in React state        |
|                     +---> User Ignores  -> Original text kept 100% untouched   |
|                     +---> User Continues Typing -> Auto-rechecked in bg        |
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
| **Primary Model** | `Xenova/all-mpnet-base-v2` |
| **Model Size** | ~438 MB (High-precision 768-dimensional ONNX weights) |
| **Fallback Model** | `Xenova/all-MiniLM-L6-v2` (~23 MB) for constrained devices |
| **Model Task** | Feature Extraction / Semantic Text Representation |
| **Model Version** | `2.0.0` |
| **License** | **Apache 2.0** (Permissive open source) |
| **Download Source** | [Hugging Face Hub (`Xenova/all-mpnet-base-v2`)](https://huggingface.co/Xenova/all-mpnet-base-v2) |
| **Inference Hardware** | WebGPU (Primary) with WebAssembly / CPU (Fallback) |

---

## Hardware & Browser Requirements

1. **Modern Browser:** Chrome/Chromium 113+, Edge 113+, Firefox 120+, or Safari 17+.
2. **Hardware Acceleration:**
   - Devices with WebGPU support automatically execute inference on the local GPU.
   - Devices lacking WebGPU fall back to WebAssembly (WASM) multithreading or CPU SIMD.
3. **Bandwidth:** The model weights are downloaded **only once** upon the user's first explicit click on *"Run Local AI Check"*, and cached in browser storage.
4. **Auto-Recheck & Verified State:**
   - After the first run, any subsequent keystrokes or line item modifications trigger an automatic, debounced background evaluation.
   - When all fields are properly specified, a prominent **"Request Writing Quality Verified"** card confirms that the requisition is clear and ready for review.

---

## Configuration & Feature Flags

The local AI feature is controlled via an environment variable in `.env` (or Vercel environment settings for live deployments):

```env
# Enable browser-local AI assistance (default: false or missing)
VITE_LOCAL_AI_ENABLED=true
```

- **`VITE_LOCAL_AI_ENABLED=false` (or missing):** Hides the optional local AI check button. The authoritative deterministic rule engine remains fully active.
- **`VITE_LOCAL_AI_ENABLED=true`:** Enables the *"Run Local AI Check"* button.

---

## Why AI Cannot Make Approval Decisions

1. **Institutional Governance:** S.P. College procurement decisions involve public funds, statutory quotas, and institutional financial accountability. Approval decisions must follow documented authority matrices (Purchase Committee, Principal, CDC, Chairman).
2. **Non-Deterministic Vulnerability:** Large or small language models can hallucinate, omit edge conditions, or misinterpret institutional policy rules.
3. **Audit Trail Integrity:** Regulatory compliance requires deterministic, tamper-evident approval records signed with cryptographic signatures.
