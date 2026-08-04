# WINE AI engineering execution policy

## Working mode

The project is developed as a senior engineering team: architecture, implementation, review, tests, deployment verification, and regression checks are completed without waiting for routine approvals.

## Release gate

A change can reach `main` only after:

1. syntax and static checks pass;
2. automated tests pass;
3. PostgreSQL schema and migration checks pass when data structures are affected;
4. risky writes are transactional and auditable;
5. destructive operations have preview and explicit confirmation;
6. Railway deployment status is verified;
7. known limitations are recorded honestly.

## Current priority

1. Knowledge Studio reliability;
2. quality and traceability of facts and sources;
3. Wine.md catalogue synchronization;
4. answer audit and benchmark quality;
5. internet fallback for dynamic official information.

New speculative intelligence modules stay frozen until benchmark failures prove that they are required.
