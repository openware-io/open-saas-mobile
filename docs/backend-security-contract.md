# SaaS H5 security contract

This frontend requires a same-origin, server-managed session. It does not accept bearer tokens, tenant context, member identifiers, or API base URLs from query parameters or WebView injection.

## Session and OAuth

- `POST /api/v1/identity/oauth/im/callback` validates authorization code, PKCE verifier, registered client ID, exact redirect URI, and state. It returns `{ authenticated: true }` and sets a `__Host-saas_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`.
- `GET /api/v1/auth/session` returns only the authenticated user and permitted scopes. It never returns access or refresh tokens.
- `POST /api/v1/auth/logout` revokes the server session and expires the cookie.
- `GET /api/v1/auth/csrf` returns a short-lived CSRF token. Every same-origin state-changing request validates `Origin` and `X-CSRF-Token`.

## Authorization

- `POST /api/v1/auth/context/select` verifies the caller can access `contextId` and stores the active context in the session. Business services derive tenant, organization, store, account, and permissions from that session.
- Customer endpoints are `/api/v1/me/orders`, `/api/v1/me/reservations`, `/api/v1/me/wallet`, `/api/v1/me/wallet/ledger`, and `/api/v1/me/points`. They derive the member identity from the session and never accept a client member ID.
- Every business mutation rechecks role, tenant/store ownership, resource ownership, lifecycle version, payment method, and server-calculated amount. Idempotency keys are persisted with the request digest and outcome.

## Third-party access

Third-party clients are registered with immutable client IDs, exact callback allowlists, scopes, and allowed origins. Public clients use OAuth authorization code with PKCE; confidential clients exchange codes only from their backend. Tokens never appear in URLs or browser storage.
