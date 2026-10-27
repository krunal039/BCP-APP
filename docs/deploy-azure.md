# Deploy to Azure — West Europe (pilot)

Lean path to host the BCP API on **Azure Container Apps** in **West Europe**, with Postgres Flexible Server, Key Vault, and Application Insights. **Azure Communication Services (ACS) is not created by this stack** — treat it as an existing resource and link secrets into Key Vault.

No Azure login is required for PRs or the default CI build. Deploy is **manual** (`workflow_dispatch`) or local `az deployment`.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Azure subscription | Contributor (or equivalent) on a resource group |
| Azure CLI ≥ 2.60 | `az login` for local deploys |
| Bicep CLI | Via `az bicep` (auto-install) or standalone |
| Docker | To build `apps/api/Dockerfile` |
| GitHub repo secrets | Only needed for Actions deploy (see below) |
| Existing ACS resource | SMS connection string + E.164 from-number (sandbox OK for pilot) |

**Region:** `westeurope` only in `infra/main.bicep` (`@allowed(['westeurope'])`). North Europe is HA later — not provisioned here.

---

## What gets created

| Resource | Purpose |
|---|---|
| User-assigned managed identity | Container App → Key Vault secrets + ACR pull |
| Log Analytics + Application Insights | Logs / request telemetry (`APPLICATIONINSIGHTS_CONNECTION_STRING`) |
| Postgres Flexible Server `B1ms` | API database (PII residency West Europe) |
| Key Vault (RBAC) | `database-url`, `jwt-secret`, ACS placeholders |
| Azure Container Registry (optional) | API images |
| Container Apps Environment + `*-api` app | Public HTTPS → `/health` on port 3001 |
| Redis Basic C0 | **Optional** (`enableRedis=false` by default) |

---

## Environment variables (API)

Wired by Bicep / Key Vault unless noted.

| Env | Source | Required |
|---|---|---|
| `NODE_ENV` | `production` | yes |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | yes |
| `DATABASE_URL` | Key Vault `database-url` | yes (prod) |
| `JWT_SECRET` | Key Vault `jwt-secret` | yes (prod, ≥32 chars) |
| `JWT_EXPIRES_IN` | `8h` | optional |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | App Insights output | recommended |
| `ACS_CONNECTION_STRING` | Key Vault `acs-connection-string` | only when `wireAcsSecrets=true` |
| `ACS_PHONE_NUMBER` | Key Vault `acs-phone-number` | only when `wireAcsSecrets=true` |
| `ACS_WEBHOOK_SECRET` | Key Vault `acs-webhook-secret` | recommended when ACS live |
| `SMS_FROM` | alias of phone | optional |

Until ACS is linked and `wireAcsSecrets=true`, the API uses the **stub DeliveryPort** (same as local/CI) — safe for infra soak without SMS.

Match local names in `apps/api/.env.example`.

---

## ACS as an external resource

Do **not** expect `infra/main.bicep` to create Communication Services. Provision (or reuse) ACS in the portal / separate template, then link:

### 1. Create / locate ACS

1. Azure Portal → **Communication Services** → create (or pick existing) in a region that supports your SMS path.
2. **Keys** → copy **Connection string**.
3. **Phone numbers** (or Sender ID) → copy E.164 from-number (sandbox numbers are fine for pilot).

### 2. Store in Key Vault

```bash
RG=<resource-group>
KV=<key-vault-name>   # from deployment output keyVaultName

az keyvault secret set --vault-name "$KV" --name acs-connection-string \
  --value 'endpoint=https://<resource>.communication.azure.com/;accesskey=<key>'

az keyvault secret set --vault-name "$KV" --name acs-phone-number \
  --value '+15555550100'

az keyvault secret set --vault-name "$KV" --name acs-webhook-secret \
  --value "$(openssl rand -hex 32)"
```

### 3. Wire into the Container App

Redeploy with `wireAcsSecrets=true` (Bicep / Actions input), **or** add the three secret refs + env vars manually on the Container App to match `infra/modules/container-apps.bicep`.

### 4. Delivery webhooks

Point Event Grid / ACS SMS delivery reports to:

`POST https://<api-fqdn>/webhooks/acs/sms-delivery`

Send header `x-acs-webhook-secret: <value>` (or `Authorization: Bearer …`) matching Key Vault `acs-webhook-secret`.

Never commit ACS connection strings, keys, or phone numbers.

---

## First deploy (local)

```bash
# 1. Resource group in West Europe
az group create -n bcp-pilot-rg -l westeurope

# 2. Deploy infra (secrets via CLI — not committed)
JWT=$(openssl rand -base64 48)
PGPASS=$(openssl rand -base64 24)

az deployment group create \
  -g bcp-pilot-rg \
  -f infra/main.bicep \
  -p infra/environments/pilot.bicepparam \
  -p postgresAdminPassword="$PGPASS" \
  -p jwtSecret="$JWT"

# 3. Note outputs
az deployment group show -g bcp-pilot-rg -n main \
  --query properties.outputs -o json
# → apiUrl, acrLoginServer, keyVaultName, postgresFqdn, …

# 4. Build + push API image
ACR=$(az deployment group show -g bcp-pilot-rg -n main --query properties.outputs.acrLoginServer.value -o tsv)
az acr login -n "${ACR%%.*}"
docker build -f apps/api/Dockerfile -t "$ACR/bcp-api:pilot" .
docker push "$ACR/bcp-api:pilot"

# 5. Point Container App at the real image
az deployment group create \
  -g bcp-pilot-rg \
  -f infra/main.bicep \
  -p infra/environments/pilot.bicepparam \
  -p postgresAdminPassword="$PGPASS" \
  -p jwtSecret="$JWT" \
  -p containerImage="$ACR/bcp-api:pilot"

# 6. Migrate + seed (one-shot against Postgres; or exec into a job later)
# Use DATABASE_URL from Key Vault secret database-url
export DATABASE_URL="$(az keyvault secret show --vault-name <kv> --name database-url --query value -o tsv)"
pnpm --filter @bcp/api db:migrate
SEED_ADMIN_PASSWORD='ChangeMeAdmin1!' pnpm --filter @bcp/api db:seed

# 7. Smoke
curl -sS "https://<api-fqdn>/health"
```

Then link ACS (section above) and set `wireAcsSecrets=true` when ready for live SMS.

---

## GitHub Actions deploy

Workflow: [`.github/workflows/deploy-azure.yml`](../.github/workflows/deploy-azure.yml)

- Trigger: **`workflow_dispatch` only** (manual).
- Does **not** run on pull_request — PRs stay green without Azure credentials.
- Builds/pushes `bcp-api` to ACR, then deploys `infra/main.bicep`.

### Repository secrets / variables

| Name | Type | Purpose |
|---|---|---|
| `AZURE_CLIENT_ID` | secret | App registration (federated credential / SP) for OIDC |
| `AZURE_TENANT_ID` | secret | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | secret | Target subscription |
| `AZURE_RESOURCE_GROUP` | secret | Existing RG in West Europe (create once) |
| `BCP_POSTGRES_ADMIN_PASSWORD` | secret | Postgres admin password |
| `BCP_JWT_SECRET` | secret | API JWT HMAC (≥32 chars) |
| `BCP_DEPLOYER_OBJECT_ID` | variable/secret | Optional SP object ID → Key Vault Secrets Officer |
| `BCP_ACS_CONNECTION_STRING` | secret | Optional; omit until ACS linked |
| `BCP_ACS_PHONE_NUMBER` | secret | Optional E.164 |
| `BCP_ACS_WEBHOOK_SECRET` | secret | Optional webhook shared secret |

OIDC login uses `azure/login` with `client-id` / `tenant-id` / `subscription-id` (no client secret if federated credentials are configured on the app registration).

### Workflow inputs

| Input | Default | Meaning |
|---|---|---|
| `name_prefix` | `bcp-pilot` | Resource name prefix |
| `enable_redis` | `false` | Provision Redis Basic |
| `wire_acs_secrets` | `false` | Mount ACS Key Vault refs on the app |
| `image_tag` | `github.sha` | Tag pushed to ACR |

---

## Validate IaC without Azure

```bash
az bicep build --file infra/main.bicep
```

CI runs the same compile on every PR (no secrets).

---

## Security notes (pilot)

- No secrets in git, images, or PR logs.
- Key Vault RBAC: API identity = **Secrets User**; optional deployer = **Secrets Officer**.
- Postgres: public access + “Allow Azure services” firewall for MVP; Private Link post-pilot.
- ACS placeholders in Key Vault are **not** mounted until `wireAcsSecrets=true`.
- Rotate `jwt-secret` / DB password via Key Vault + Container App revision restart.
