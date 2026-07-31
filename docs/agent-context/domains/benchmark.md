# Benchmark generator

The benchmark system creates and validates Positive and Negative questions against a selected indexed document corpus.

## Acceptance rules

- A Positive item is accepted only when the answer is supported by identified source evidence.
- A Negative item is accepted only when the indexed corpus does not contain enough information to answer it.
- Requested counts refer to accepted items. Rejected or duplicate candidates do not satisfy the target.
- Generation runs in bounded batches with bounded retries and a visible terminal state.
- A dataset may finish as `complete` or `partial`; never label a short dataset complete.
- Persist rejection reasons, evidence, source identifiers, and generation settings needed for later review.

## Change discipline

Treat validators, dataset JSON shapes, tests, and `docs/PHASE_6A.md` as the specification. Changes to generation prompts alone are insufficient when acceptance behavior or stored fields also change.

Do not use topic similarity as proof that a Negative question is answerable. Evaluate whether the corpus contains the facts required for the answer.

## Verification focus

Use a small deterministic fixture where possible. Check accepted counts, duplicate removal, retry limits, cancellation or failure, persisted terminal status, export shape, and admin UI rendering. A live OpenAI run remains separate evidence and requires valid paid credentials.