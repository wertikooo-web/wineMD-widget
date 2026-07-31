# Verification

Choose checks from the changed surface. During development, run targeted tests. Before closing a repository-wide refactor, run the full non-destructive suite once when the environment permits it.

## Baseline

- Review the final diff and confirm that only intended files changed.
- Run `npm test` for code changes.
- Start the service with safe local configuration when server or route behavior changed.
- Verify that startup failure messages identify missing configuration without printing secret values.

## Public widget and browser UI

- Load the actual page in a browser.
- Check the main interaction and the browser console.
- Inspect the request and response contract used by the page.
- Recheck microphone permission, stop/cancel behavior, and repeated sessions when voice code changed.

## Knowledge and ingestion

- Test an empty corpus.
- Test at least one representative document and query.
- Confirm that returned answers retain evidence or source linkage where the contract provides it.
- Confirm that parser or embedding failures produce inspectable errors and do not invent content.

## Admin and benchmark

- Check route authorization and payload validation.
- Confirm background jobs expose progress and reach `complete`, `partial`, or failed terminal states.
- Confirm retries are bounded and duplicate accepted questions are rejected.
- For Positive items, verify source evidence. For Negative items, verify the corpus does not contain an answer.

## Storage

- Test reading existing data before and after schema or serialization changes.
- Keep migrations repeatable or explicitly one-way.
- Do not use production data as the first validation environment.

## Completion report

State what changed, which checks passed, which checks were skipped, and what remains unverified. Real paid-provider behavior stays unverified unless it was actually exercised with valid credentials.