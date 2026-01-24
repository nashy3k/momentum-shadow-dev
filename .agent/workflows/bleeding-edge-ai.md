---
description: How to handle bleeding-edge AI models and integration hurdles (Gemini 3, Opik 401s)
---

This workflow ensures stability when working with the latest AI models and observability tools that may outpace standard framework plugins.

### 1. Model Selection Strategy
- **Framework vs. SDK**: If a high-level framework (like Genkit) fails with "Unknown Field" or "Tools not recognized" errors on a new model (e.g., Gemini 3), switch to the **Direct SDK** (`@google/generative-ai`) for the model call.
- **Hybrid Pattern**: Wrap the Direct SDK call inside the framework's "Flow" or "Action" to maintain architectural benefits (observability, type safety) without the plugin bugs.
- **Prompt Hardening**: For preview models, use a strict `systemInstruction` to force tool-calling behavior: `"You are an agent. ONLY output JSON tool calls. DO NOT talk."`

### 2. Environment & Observability (Opik)
- **Windows Auth Fix**: If Opik returns `401: API key should be provided` despite being set in `.env`, manually inject headers into the constructor:
  ```typescript
  const opik = new Opik({
    apiKey: process.env.OPIK_API_KEY,
    headers: {
      'Authorization': process.env.OPIK_API_KEY,
      'Comet-Workspace': process.env.OPIK_WORKSPACE,
    }
  });
  ```
- **Manual .env Parsing**: On Windows, use `dotenv.parse(fs.readFileSync('.env'))` to ensure keys are loaded into `process.env` before any SDK is initialized.

### 3. Reliability
- **Retry Logic**: Preview models (Flash tier) often return 429 or 503 errors. Always wrap model calls in a retry loop (3 attempts with 2s backoff) to ensure agent continuity.
