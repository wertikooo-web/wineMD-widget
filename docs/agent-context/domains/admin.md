# Admin surface

The admin area manages documents, indexing, testing, and benchmark jobs. It operates across a stronger trust boundary than the public widget.

## Design rules

- Keep authorization checks on the server. Hiding controls in the browser is not access control.
- Validate methods, content types, payload shapes, identifiers, limits, and state transitions.
- Long-running work must return a job identifier and expose progress plus a terminal state.
- Browser polling must stop on terminal state, cancellation, navigation, or repeated failure.
- Admin errors may be detailed enough to diagnose the task but must not reveal secrets or private document contents unnecessarily.
- Public routes must not reuse admin credentials from browser-global state or query parameters.

## References

Inspect route guards, request handlers, the admin page, browser scripts, repositories, background job state, and tests. Use actual route payloads as contracts.

## Verification focus

Check unauthorized access, invalid input, one successful operation, one failed background job, and UI recovery after refresh or repeated polling.