# Glencore BCP-APP — Pilot checklist

**Repo:** [krunal039/BCP-APP](https://github.com/krunal039/BCP-APP)  
**Companion:** [project-runbook.md](./project-runbook.md) · Azure: repo `docs/deploy-azure.md`  
**Goal:** Dual-control (or bypass) alert reaches a DRC pilot cohort via **SMS + push**, with delivery status and full audit.

---

## 0. Merge verification

| Check | Expected | Notes |
|---|---|---|
| [ ] PR [#7](https://github.com/krunal039/BCP-APP/pull/7) | **MERGED** (E1 Azure West Europe Bicep + Actions) | Merged into stack tip `cursor/azure-west-europe-deploy-40cf` |
| [ ] PR [#8](https://github.com/krunal039/BCP-APP/pull/8) | **MERGED** (E6 Expo push) | Merged into same stack tip |
| [ ] Prior stack [#1](https://github.com/krunal039/BCP-APP/pull/1)–[#6](https://github.com/krunal039/BCP-APP/pull/6) | MERGED | Auth → members → dual-control → ACS → UI |
| [ ] Working tip | Contains E0–E8 + E1 + E6 | Tip: `cursor/azure-west-europe-deploy-40cf` (includes #8 merge) |
| [ ] `main` | Promote stack → `main` before prod pilot | As of verification: `main` still at E0 (#1) only — use stack tip or merge to `main` first |

```bash
gh pr view 7 --json state,mergedAt,baseRefName
gh pr view 8 --json state,mergedAt,baseRefName
git fetch origin
git log --oneline origin/cursor/azure-west-europe-deploy-40cf -5
```

---

## 1. Seed admin

Local (or against Azure Postgres `DATABASE_URL` from Key Vault):

```bash
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL + JWT_SECRET
pnpm install
pnpm --filter @bcp/api db:generate
pnpm --filter @bcp/api db:migrate
SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api db:seed
```

| Check | Pass criteria |
|---|---|
| [ ] Seed completes | Logs `Seeded admin user "admin"` |
| [ ] Login | `POST /auth/login` with `admin` / seed password → JWT |
| [ ] Role | `GET /auth/me` includes `admin` |
| [ ] Password rotated | Change seed password before any shared/pilot env |

Optional: `SEED_ADMIN_PASSWORD='…' pnpm --filter @bcp/api smoke:auth`

---

## 2. Create sender + approver

As **admin** (web console or API):

```bash
# Sender
curl -sS -X POST "$API/users" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d '{"username":"pilot_sender","password":"SenderPass1234","displayName":"Pilot Sender","roles":["sender"],"urgentBypass":false}'

# Approver (different person)
curl -sS -X POST "$API/users" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d '{"username":"pilot_approver","password":"ApproverPass1234","displayName":"Pilot Approver","roles":["approver"],"urgentBypass":false}'

# Optional: sender with urgent bypass for bypass drill
curl -sS -X PATCH "$API/users/<senderId>/roles" -H "authorization: Bearer $ADMIN_JWT" \
  -H 'content-type: application/json' \
  -d '{"roles":["sender"],"urgentBypass":true}'
```

| Check | Pass criteria |
|---|---|
| [ ] Two distinct users | Separate usernames; neither is the other |
| [ ] Roles | Sender has `sender`; Approver has `approver` |
| [ ] Bypass flag | Only on the user intended for the bypass path |
| [ ] Login both | Both can sign in on web (`:3000`) and mobile |

---

## 3. Import members (DRC)

CSV headers (aliases OK): **`displayName`** (or `name`) + **`e164`** (or `phone`); optional `countryCode` (default **`CD`**).

```csv
displayName,e164,countryCode
Pilot Member One,+243800000001,CD
Pilot Member Two,+243800000002,CD
```

| Check | Pass criteria |
|---|---|
| [ ] Import | Admin → Members → CSV import (`POST /members/import`) succeeds; row errors reviewed |
| [ ] Group | Create DRC pilot group; add imported members |
| [ ] Phones | `GET /groups/:id/phones` → `sendable: true` |
| [ ] Push link (optional) | For push receive: set `Member.userId` to the logged-in recipient/user who registered a device token |

---

## 4. Compose → approve (Approver ≠ Sender)

| Step | Actor | Action |
|---|---|---|
| 1 | Sender | Compose alert (template or free text) → target pilot group → submit |
| 2 | Same sender | Attempt approve on own alert |
| 3 | Approver | Approve the pending alert |
| 4 | Either | Open delivery status |

| Check | Pass criteria |
|---|---|
| [ ] Submit | Alert → `pending_approval` |
| [ ] Self-approve blocked | Sender approve → **403** (Approver ≠ Sender) |
| [ ] Cross-approve | Approver approve succeeds → fan-out starts |
| [ ] Reject path (optional) | Approver reject → `rejected`; no fan-out |

---

## 5. Bypass path

| Check | Pass criteria |
|---|---|
| [ ] Capability required | User without `urgentBypass` cannot bypass |
| [ ] Reason mandatory | Empty reason rejected |
| [ ] Bypass succeeds | Capable sender/admin + reason → `bypassed` → fan-out |
| [ ] Audit | Event records actor, `bypass`, reason, alert id |

---

## 6. SMS + push verification

### SMS (ACS)

| Check | Pass criteria |
|---|---|
| [ ] ACS env live | `ACS_CONNECTION_STRING` + `ACS_PHONE_NUMBER` (or `SMS_FROM`) set (local `.env` or Key Vault + `wireAcsSecrets=true`) |
| [ ] Handset | Pilot DRC/test number receives SMS |
| [ ] Delivery status | `queued → submitted → delivered|failed` via webhook `POST /webhooks/acs/sms-delivery` |
| [ ] Stub fallback | Without ACS env, stub DeliveryPort only (no live SMS) — confirm intentionally |

### Push (Expo)

| Check | Pass criteria |
|---|---|
| [ ] `EXPO_PUSH_ENABLED=true` | API calls Expo Push (not expo-stub) |
| [ ] Physical device | Login → allow notifications → token `POST /me/device-tokens` |
| [ ] Member link | Target member has `userId` = that auth user |
| [ ] Receive | Same alert delivers secondary push on device |
| [ ] Optional | `EXPO_ACCESS_TOKEN` set in prod/pilot |

---

## 7. Audit

| Check | Pass criteria |
|---|---|
| [ ] Compose | `GET /audit?alertId=…` shows composer |
| [ ] Approve / reject | Approver actor recorded |
| [ ] Bypass | Actor + reason recorded |
| [ ] Delivery | Provider message IDs / delivery events present for SMS (and push when enabled) |
| [ ] Seed | `user.seed_admin` present from seed step |

---

## Sign-off (MVP DoD slice)

Pilot technical drill is green when:

1. Stack tip (or `main` after promote) includes #7 + #8  
2. Admin seeded; distinct Sender + Approver exist  
3. DRC members imported and group sendable  
4. Self-approve **403**; cross-approve fans out  
5. Bypass works only with capability + reason + audit  
6. Live SMS and/or push verified (or stub path explicitly accepted for infra-only soak)  
7. Audit trail exportable for the drill alert  

**Out of pilot MVP:** acknowledgment, Entra/SSO, email/voice, multi-country sender packs.
