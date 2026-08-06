# Autonomy policy

## Read-only requests

For requests to explain, audit, review, diagnose, compare, or plan, inspect the required repository evidence and report findings. Do not edit files.

## Change requests

For requests to fix, build, refactor, or update, make local repository changes within the stated scope and run non-destructive checks. Routine file edits, test additions, and documentation updates do not require another confirmation once the task is explicit.

## Confirmation required

Stop before:

- deploying or changing production configuration;
- merging a pull request;
- destructive or irreversible data changes;
- changing access, authentication providers, billing, or paid API resources;
- publishing packages or sending external communications;
- widening the product scope beyond the requested change.

## Secrets and private data

Use environment variable names, never secret values. Do not print full environment files, tokens, authorization headers, uploaded private documents, or saved user audio. When a real-provider check requires credentials, state the missing proof instead of exposing or inventing credentials.

## Scope discipline

Preserve unrelated work. Choose the smallest useful set of files. When an adjacent defect blocks verification, either fix it only when tightly coupled to the task or record it separately.