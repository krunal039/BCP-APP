# Glencore BCP Critical Notifications

Monorepo for the Glencore BCP Critical Notifications MVP: dual-control SMS + push alerts to a DRC-first cohort (~10k), with a thin web admin console and Expo mobile app.

## Locked decisions

| Topic | Decision |
|---|---|
| Mobile | **Expo / React Native** |
| API | **Node / TypeScript** |
| Web admin | **Next.js** |
| SMS | Azure Communication Services (ACS adapter + delivery webhooks) |
| Azure region | **West Europe** (Postgres / PII + deploy); North Europe = HA later |
| Auth (MVP) | Username / password + in-app roles (no Entra) |
| Approval | **Approver ≠ Sender** — enforced server-side on every normal approve |
| Urgent bypass | Allowed with mandatory reason + audit |
| Acknowledgment | Out of MVP |
| Channels | SMS + push only |

## Workspace layout

```
apps/
  api/       Node/TS Fastify API (+ Prisma schema v1)
  web/       Next.js admin console
  mobile/    Expo (RN + TS) app shell
packages/
  shared/    Zod schemas + domain types (roles, alerts, members, delivery)
infra/       Bicep/Terraform placeholders (West Europe) — E1
```

Package manager: **pnpm** · Task runner: **Turborepo**.

## Prerequisites

- Node.js ≥ 20
- pnpm 10 (`corepack enable` recommended)
- Docker (optional, for API image)
- Postgres (optional until you run migrations)

## Install

```bash
pnpm install
```

## Develop

```bash
# All apps (API :3001, web :3000, Expo Metro)
pnpm dev

# Individually
pnpm --filter @bcp/api dev
pnpm --filter @bcp/web dev
pnpm --filter @bcp/mobile dev
```

API health check:

```bash
curl -s http://localhost:3001/health | jq
```

## Web + mobile against local API (E7 / E8 MVP UI)

The Next.js console and Expo app call the Fastify API directly (CORS enabled for local browsers). No Azure deploy required for this slice.

1. **Start Postgres + migrate + seed** (see Database section below).
2. **API** on `:3001`:

```bash
cp apps/api/.env.example apps/api/.env   # if needed
pnpm --filter @bcp/api db:generate
pnpm --filter @bcp/api db:migrate
SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api db:seed
pnpm --filter @bcp/api dev
```

3. **Web admin** (`apps/web`) on `:3000`:

```bash
cp apps/web/.env.example apps/web/.env.local   # optional; defaults to http://localhost:3001
pnpm --filter @bcp/web dev
```

Open http://localhost:3000 → sign in with the seeded admin (or Sender/Approver users you create via `POST /users`). Nav is role-gated: Members/Groups (read for Sender/Approver; mutate Admin), Compose (Sender/Admin), Approvals (Approver/Admin), Delivery status.

4. **Expo mobile** (`apps/mobile`):

```bash
cp apps/mobile/.env.example apps/mobile/.env   # set EXPO_PUBLIC_API_URL
pnpm --filter @bcp/mobile dev
```

| Client | `EXPO_PUBLIC_API_URL` / notes |
|---|---|
| iOS simulator / Expo web | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical device | `http://<your-lan-ip>:3001` (API must listen on `0.0.0.0`) |

Mobile flows: login → compose/submit for approval → approval queue (approve/reject) → urgent bypass (capability + reason) → basic delivery status. Roles are enforced by the API; the UI only hides unavailable actions.

**Dual-control reminder:** Approver ≠ Sender is rejected with 403 by the API even if the UI is wrong.

## Build

```bash
pnpm build
```

Builds `@bcp/shared`, then API (tsc), web (`next build`), and mobile (typecheck).

## Database (E0.4 scaffold)

Prisma schema + initial migration live under `apps/api/prisma/`.

```bash
cp apps/api/.env.example apps/api/.env
# set DATABASE_URL to a local or West Europe Postgres instance
pnpm --filter @bcp/api db:generate
pnpm --filter @bcp/api db:migrate
pnpm --filter @bcp/api db:seed   # requires SEED_ADMIN_PASSWORD in env / .env
```

Schema includes auth users/roles, directory **members** + phones (`e164` + `countryCode`, default `CD`), groups / group_members, templates, alerts (`senderUserId` / `approverUserId`), approvals, delivery_events, audit_events, and device tokens.

**Approver ≠ Sender:** `Alert.senderUserId` and `Alert.approverUserId` are separate columns so the API can reject self-approval (403) in E4. Documented here only for scaffold; enforcement lands with the approvals epic.

**Directory vs auth:** `Member` is the SMS/push cohort entity (~10k). Auth `User` accounts are separate; an optional `Member.userId` can link a recipient login later.

## Auth & roles (E2)

Username/password (argon2id) + JWT access tokens. Roles: `recipient` | `sender` | `approver` | `admin`. Optional `urgentBypass` capability (defaults off). No Entra in MVP.

| Method | Path | Authz |
|---|---|---|
| `POST` | `/auth/login` | public |
| `POST` | `/auth/logout` | authenticated (bumps `tokenVersion` → revokes JWT) |
| `GET` | `/auth/me` | authenticated |
| `POST` | `/users` | admin — create user + roles |
| `PATCH` | `/users/:id/roles` | admin — replace roles / bypass flag (audited; revokes tokens) |
| `GET` | `/rbac/sender` · `/rbac/approver` · `/rbac/admin` | role probe routes for smoke tests |

Password policy: min 12 chars, at least one letter + one number. Lockout after 5 failed logins (15 minutes). Tokens and passwords are redacted from logs.

```bash
# unit tests (no DB)
pnpm --filter @bcp/api test:unit

# integration (needs DATABASE_URL + migrated DB)
pnpm --filter @bcp/api test:integration

# curl smoke against a running API
SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api smoke:auth
```

**Refresh strategy:** access JWT only (default 8h via `JWT_EXPIRES_IN`). Logout and role changes invalidate immediately via `User.tokenVersion`. Refresh tokens can land later if mobile needs longer sessions without re-login.

## Members & groups (E3)

DRC-first directory: E.164 phones with extensible `countryCode` (default `CD`). Paginated list endpoints sized for ~10k. Mutations are **Admin-only**; Sender/Approver may read (for compose later).

| Method | Path | Authz |
|---|---|---|
| `GET` | `/members` · `/members/:id` | sender / approver / admin |
| `POST` | `/members` | admin |
| `PATCH` | `/members/:id` | admin |
| `POST` | `/members/:id/deactivate` | admin (soft-delete) |
| `POST` | `/members/:id/phones` · `PATCH` …`/phones/:phoneId` | admin |
| `POST` | `/members/import` | admin — CSV (`text/csv` or `{ csv }`); row-level errors; audited |
| `GET` | `/groups` · `/groups/:id` · `/groups/:id/members` · `/groups/:id/phones` | sender / approver / admin |
| `POST` | `/groups` · `/groups/:id/members` | admin |
| `PATCH` / `DELETE` | `/groups/:id` · `DELETE /groups/:id/members/:memberId` | admin |

`GET /groups/:id/phones` resolves active member phones for send-time targeting; empty groups report `sendable: false` (E4 blocks targeting). Contact basis (`employment` / `consent` / `other`) is stored on each member.

```bash
pnpm --filter @bcp/api smoke:members
```

## Dual-control alerts (E4)

Templates + compose + Approver ≠ Sender + urgent bypass. Recipient ack is out of MVP.

| Method | Path | Authz |
|---|---|---|
| `GET` / `POST` | `/templates` · `GET`/`PATCH /templates/:id` | read: sender/approver/admin · mutate: admin |
| `GET` / `POST` | `/alerts` | read: sender/approver/admin · compose: sender/admin |
| `POST` | `/alerts/bypass` | sender/admin + `urgentBypass` + mandatory `reason` |
| `POST` | `/alerts/:id/submit` | sender/admin — draft → pending_approval |
| `POST` | `/alerts/:id/approve` · `/reject` | approver/admin — **403 if actor = sender** |
| `POST` | `/alerts/:id/bypass` | sender/admin + capability + reason |
| `GET` | `/alerts/:id/deliveries` | sender/approver/admin |
| `GET` | `/audit` | sender/approver/admin — filter by `alertId` / `action` |

State machine: `draft → pending_approval → approved|rejected` (normal) or `draft → bypassed` (urgent); approve/bypass snapshots recipients then fans out → `sending → completed|partial_failure`.

## ACS SMS delivery (E5)

Fan-out uses **Azure Communication Services** when configured; otherwise the in-memory **stub** (safe for CI / local without Azure secrets). Push remains an Expo placeholder until E6.

| Env | Required? | Purpose |
|---|---|---|
| `ACS_CONNECTION_STRING` | for live SMS | ACS resource connection string (Key Vault in Azure) |
| `ACS_PHONE_NUMBER` | for live SMS | ACS-owned E.164 from-number (or registered sender) |
| `SMS_FROM` | alias | Same as `ACS_PHONE_NUMBER` if the latter is unset |
| `ACS_WEBHOOK_SECRET` | recommended in prod | Shared secret for delivery webhooks |

| Method | Path | Authz |
|---|---|---|
| `POST` | `/webhooks/acs/sms-delivery` | Event Grid → ACS delivery reports (optional `x-acs-webhook-secret` / Bearer). Handles subscription validation. |

Delivery lifecycle per recipient: `queued → submitted → delivered|failed`. Webhooks match on `providerMessageId` (ACS `messageId`). Unknown IDs are logged and ignored. Alert stays `sending` after ACS submit until DLRs arrive (stub path completes immediately).

```bash
pnpm --filter @bcp/api test:unit          # ACS adapter (mocked SDK) + webhook auth/validation
pnpm --filter @bcp/api test:integration   # dual-control + webhook persistence (needs DB)
```

Do **not** put ACS secrets in git or CI. Omit ACS_* in GitHub Actions so tests always use the stub.

## Docker (API)

```bash
docker build -f apps/api/Dockerfile -t bcp-api .
docker run --rm -p 3001:3001 bcp-api
```

Do not put ACS / JWT / DB secrets in the image or in git. Use env / Key Vault at runtime (E1).

## CI

GitHub Actions stub runs install + typecheck/build on PRs (`.github/workflows/ci.yml`).

## What's next

See Project docs: `mvp-build-plan.md` / `mvp-backlog.md` — continue E1 (West Europe Azure), E6 (Expo push), templates UI polish, store prep, then E9 hardening.
