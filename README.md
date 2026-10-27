# Glencore BCP Critical Notifications

Monorepo for the Glencore BCP Critical Notifications MVP: dual-control SMS + push alerts to a DRC-first cohort (~10k), with a thin web admin console and Expo mobile app.

## Locked decisions

| Topic | Decision |
|---|---|
| Mobile | **Expo / React Native** |
| API | **Node / TypeScript** |
| Web admin | **Next.js** |
| SMS | Azure Communication Services (**later** — adapter in E5) |
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

Schema includes users, roles, phones (`e164` + `countryCode`), groups, templates, alerts (`senderUserId` / `approverUserId`), approvals, delivery_events, audit_events, and device tokens.

**Approver ≠ Sender:** `Alert.senderUserId` and `Alert.approverUserId` are separate columns so the API can reject self-approval (403) in E4. Documented here only for scaffold; enforcement lands with the approvals epic.

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

## Docker (API)

```bash
docker build -f apps/api/Dockerfile -t bcp-api .
docker run --rm -p 3001:3001 bcp-api
```

Do not put ACS / JWT / DB secrets in the image or in git. Use env / Key Vault at runtime (E1).

## CI

GitHub Actions stub runs install + typecheck/build on PRs (`.github/workflows/ci.yml`).

## What's next

See Project docs: `mvp-build-plan.md` / `mvp-backlog.md` — continue E1 (West Europe Azure), then members/groups (E3), dual-control alerts (E4), and ACS SMS (E5).
