# Voice pipeline

The user-facing chain is microphone or text input, optional speech-to-text, knowledge retrieval, grounded answer generation, and optional text-to-speech.

## Design rules

- Keep each stage independently observable. A failure in STT, retrieval, generation, or TTS must be reported as that stage, not as a generic voice failure.
- Cancellation and session cleanup must be idempotent. Repeated start/stop cycles must not retain stale audio, requests, timers, or UI state.
- Do not let provider-specific response shapes leak into public route contracts.
- Timeouts and retries must be bounded. Retrying a non-idempotent request requires an explicit idempotency strategy.
- Audio logs must contain metadata only unless a dedicated, privacy-reviewed feature explicitly enables storage.

## References

Inspect the server route, provider client, browser microphone code, request lifecycle, and tests for the stage being changed. Use actual request and response payloads as the specification.

## Verification focus

Exercise the first session and a second consecutive session. Check stop/cancel while recording and while output is playing. Confirm that missing provider credentials fail clearly without revealing secret values.