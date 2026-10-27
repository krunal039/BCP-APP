# Glencore BCP-APP — Project runbook

**Repo:** [krunal039/BCP-APP](https://github.com/krunal039/BCP-APP)  
**Pilot steps:** [pilot-checklist.md](./pilot-checklist.md)  
**Azure deploy (in repo):** [`docs/deploy-azure.md`](https://github.com/krunal039/BCP-APP/blob/cursor/azure-west-europe-deploy-40cf/docs/deploy-azure.md)

Working tip for full MVP (E0–E8 + Azure + Expo push): branch `cursor/azure-west-europe-deploy-40cf` (includes merged PRs [#7](https://github.com/krunal039/BCP-APP/pull/7) + [#8](https://github.com/krunal039/BCP-APP/pull/8)). Promote to `main` before production pilot.

---

## Monorepo layout

```
apps/
  api/       Fastify + Prisma (auth, members, alerts, ACS, Expo push, webhooks)
  web/       Next.js admin console (:3000)
  mobile/    Expo (RN + TS) send / approve / status
packages/
  shared/    Zod schemas + domain types
infra/       Bicep (West Europe) + pilot params
docs/        deploy-azure.md
```

Package manager: **pnpm** · Task runner: **Turborepo**.

---

## Prerequisites

| Tool | Notes |
|---|---|
| Node.js ≥ 20 | |
| pnpm 10 | `corepack enable` recommended |
| Postgres | Local Docker/Postgres or Azure Flexible Server (West Europe) |
| Docker | Optional; required for API image / Azure push |
| Azure CLI + Bicep | Only for cloud deploy (`az bicep build` / `az deployment`) |
| Expo Go or physical device | Push registration (simulators skip) |

---

## Environment variables

### API — `apps/api/.env` (from `.env.example`)

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (DB routes) | Postgres connection |
| `JWT_SECRET` | yes (≥32 chars) | Access JWT HMAC |
| `JWT_EXPIRES_IN` | no (default `8h`) | Token lifetime |
| `PORT` / `HOST` | no | Default `3001` / `0.0.0.0` |
| `SEED_ADMIN_USERNAME` | seed | Default `admin` |
| `SEED_ADMIN_PASSWORD` | seed | Min 12 chars, letter + number |
| `ACS_CONNECTION_STRING` | live SMS | ACS connection string |
| `ACS_PHONE_NUMBER` / `SMS_FROM` | live SMS | E.164 from-number |
| `ACS_WEBHOOK_SECRET` | recommended | Webhook auth |
| `EXPO_PUSH_ENABLED` | live push | `true` / `1` → Expo Push API |
| `EXPO_ACCESS_TOKEN` | recommended prod | Expo access token |

Omit ACS / Expo live flags → **stub** DeliveryPort (safe for CI/local).

### Web — `apps/web/.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Mobile — `apps/mobile/.env`

```
EXPO_PUBLIC_API_URL=http://localhost:3001
```

| Client | API URL |
|---|---|
| iOS sim / Expo web | `http://localhost:3001` |
| Android emulator | `http://10.0.2.2:3001` |
| Physical device | `http://<lan-ip>:3001` (API on `0.0.0.0`) |

---

## Local run

```bash
git fetch origin
git checkout cursor/azure-west-europe-deploy-40cf   # or main after promote
pnpm install

cp apps/api/.env.example apps/api/.env
# edit DATABASE_URL + JWT_SECRET

pnpm --filter @bcp/api db:generate
pnpm --filter @bcp/api db:migrate
SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api db:seed
```

### All apps

```bash
pnpm dev
# API :3001 · web :3000 · Expo Metro
```

### Individually

```bash
pnpm --filter @bcp/api dev
pnpm --filter @bcp/web dev      # cp apps/web/.env.example → .env.local
pnpm --filter @bcp/mobile dev  # set EXPO_PUBLIC_API_URL
```

Health: `curl -s http://localhost:3001/health | jq`

Smoke: `SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api smoke:auth`  
Members: `pnpm --filter @bcp/api smoke:members`

---

## Dual-control test flow

1. **Admin** creates distinct **sender** and **approver** (`POST /users` or web).
2. Import DRC members + group (CSV: `displayName,e164,countryCode` with `CD`).
3. **Sender** composes → submit → `pending_approval`.
4. **Same sender** approve → expect **403** (Approver ≠ Sender).
5. **Approver** approve → recipient snapshot → fan-out (SMS + push).
6. **Urgent bypass:** user with `urgentBypass=true` + mandatory reason → `bypassed` → fan-out + audit.
7. Status: `GET /alerts/:id/deliveries` or web/mobile status screens.

Full checklist: [pilot-checklist.md](./pilot-checklist.md).

---

## Enable ACS SMS + Expo push

### ACS (SMS)

1. Provision/reuse Communication Services (not created by Bicep).
2. Set locally, or in Azure Key Vault then redeploy with `wireAcsSecrets=true`:
   - `ACS_CONNECTION_STRING`
   - `ACS_PHONE_NUMBER` (E.164)
   - `ACS_WEBHOOK_SECRET`
3. Point delivery reports to `POST https://<api>/webhooks/acs/sms-delivery` with `x-acs-webhook-secret`.
4. Approve/bypass a test alert → confirm handset + status transitions.

Details: repo **`docs/deploy-azure.md`** § ACS as an external resource.

### Expo push

1. API: `EXPO_PUSH_ENABLED=true` (+ optional `EXPO_ACCESS_TOKEN`).
2. Mobile: physical device → login → allow notifications → token stored via `POST /me/device-tokens`.
3. Link `Member.userId` to that auth user so fan-out includes push.
4. Approve/bypass → confirm secondary push. `DeviceNotRegistered` soft-deactivates the token.

---

## Azure West Europe deploy

**Pointer:** follow the repo guide — [`docs/deploy-azure.md`](https://github.com/krunal039/BCP-APP/blob/cursor/azure-west-europe-deploy-40cf/docs/deploy-azure.md).

| Item | Summary |
|---|---|
| Region | **`westeurope` only** (PII / Postgres / primary deploy) |
| Stack | Container Apps (API) + Postgres Flexible Server + Key Vault + App Insights (+ optional Redis) |
| ACS | External — link secrets; `wireAcsSecrets=true` |
| Validate IaC | `az bicep build --file infra/main.bicep` (no Azure login) |
| Deploy | Manual Actions `workflow_dispatch` → `.github/workflows/deploy-azure.yml`, or local `az deployment group create` |
| Secrets | Never in git/images; see deploy guide table (`AZURE_*`, `BCP_JWT_SECRET`, …) |

After deploy: migrate + seed against Key Vault `database-url`, then `curl https://<api-fqdn>/health`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/health` OK but auth/DB 500 | Missing/bad `DATABASE_URL` or migrations | Set URL; `db:migrate` |
| Login 401 / lockout | Wrong password or 5 failures | Wait 15m or reset via seed/admin DB |
| Create user 403 | Not admin JWT | Login as seeded admin |
| Self-approve 403 | **Expected** dual-control | Use a different Approver user |
| Bypass 403 / validation | No `urgentBypass` or empty reason | Patch roles; send reason |
| No live SMS | ACS env unset → stub | Set ACS_* (or Key Vault + wire) |
| Webhook ignored | Secret mismatch / unknown message id | Match `ACS_WEBHOOK_SECRET`; check provider id |
| No push | Stub mode, simulator, or no `Member.userId` | `EXPO_PUSH_ENABLED=true`; physical device; link member |
| Mobile can't reach API | Wrong `EXPO_PUBLIC_API_URL` / firewall | Use LAN IP; API `HOST=0.0.0.0` |
| CORS / web blank API | Wrong `NEXT_PUBLIC_API_URL` | Point at `:3001` |
| Bicep / deploy fails | Region or missing secrets | Stay on `westeurope`; set Actions secrets per deploy guide |
| Features missing on `main` | Stack not promoted | Checkout `cursor/azure-west-europe-deploy-40cf` or merge stack → `main` |

---

## Quick reference — roles & ports

| Role | Typical use |
|---|---|
| `admin` | Seed, users, members/groups mutate, all ops |
| `sender` | Compose, submit, optional bypass |
| `approver` | Approve / reject (≠ sender) |
| `recipient` | App login / push target (via `Member.userId`) |

| Service | Port |
|---|---|
| API | 3001 |
| Web | 3000 |
| Expo Metro | Expo default |
