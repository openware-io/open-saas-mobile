# open-saas-mobile

[中文](README.md) | [English](README.en.md)

SaaS-facing H5 frontend (`Vue 3 + Vite`, two entries) embedded in the mobile app:

| End | Entry | Path | Responsibility |
| --- | --- | --- | --- |
| **C-end** “OpenChat services” | `index.c.html` | `/a380/` | Room selection/reservation, bills and wallet |
| **B-end** “OpenChat merchant” | `index.b.html` | `/b/` | On-site store operations: reservations, opening tables, checkout, cashier, stores |

This repo contains only the mobile-facing H5. The full web admin console lives in `open-saas-admin` at `/saas/`.

## Layout

```text
package.json              Vue 3 + Vite + Vue Router + Pinia + Axios
vite.config.c.js / .b.js  two build targets (dist-c → /a380/, dist-b → /b/)
index.c.html / index.b.html
src/
  shared/                 bridge (app-injected config) + axios + SaaS API + money/status utils
  c-end/                  C-end app (Home reservation, Mine)
  b-end/                  B-end app (Reservations, Orders, Stores)
nginx.conf                /api/ reverse proxy to the gateway
Dockerfile                one build producing both H5 bundles
VERSION                   semantic version for releases
```

## Host authorization contract (App WebView → H5)

The host only provides a one-time OAuth code via `GVBridge.login`. The H5 exchanges the code + PKCE for a same-origin HttpOnly session cookie. It never accepts or persists tokens, tenant, member or API addresses from the URL, JS injection or localStorage.

- API requests use same-origin nginx `/api/` and `/oauth/`.
- Tenant/store context is held in the server session; the browser sends no permission snapshot.
- Full backend contract: `docs/backend-security-contract.md`.

## KTV business

Amounts are always minor units (CNY fen / USD cent) and are never converted; display uses `formatMoney(minor, currencyCode?)` with the tenant currency as default.

- Currency dictionaries: C-end `c-end/money.js`, B-end `src/shared/utils/money.js` (must match; guarded by `currency-contract.test.js`).
- Settled bills and wallet ledgers keep their own currency snapshot.
- No scattered currency symbols, `/100`, `*100` or bare currency codes; guard tests enforce this.

APIs:

- Rooms: `GET /api/v1/business/resources?resourceType=KTV_ROOM`
- Reservations: `POST /api/v1/business/reservations` plus confirm/arrive/cancel
- Orders: `POST /api/v1/business/orders` (open table) + session open/close + add items + checkout + combined `collect`
- Stores: `GET /api/v1/admin/tenant/stores`
- C-end wallet/points: `GET /api/v1/me/wallet|points`

## Build and run

Local Vite proxies `/api/` and `/oauth/` to the unified Kind ingress `http://127.0.0.1:30080`:

```bash
npm ci
npm test
npm run build        # dist-c + dist-b
npm run dev:b        # B-end, port 5176
npm run dev:c        # C-end, port 5175
```

For a Kind host on another machine:

```powershell
$env:VITE_DEV_API_TARGET = 'http://<kind-host>:30080'
npm run dev:b
```

Open the deployed H5 at `http://<kind-host>:30080/a380/` and `/b/`.

The C-end uses an authorized IM user; the B-end uses an IM account granted operator permission in the SaaS tenant.
