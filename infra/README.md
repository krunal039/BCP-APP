# Infra — Azure West Europe (E1)

Lean Bicep stack for the BCP Critical Notifications **MVP pilot**.

| Item | Value |
|---|---|
| Region | **West Europe** (`westeurope`) — locked for Postgres / PII |
| Compute | Azure Container Apps (API) |
| Data | Postgres Flexible Server (Burstable `Standard_B1ms`) |
| Secrets | Key Vault (RBAC) + Container Apps secret refs |
| Telemetry | Log Analytics + Application Insights |
| Cache | Redis Basic C0 **optional** (`enableRedis=false` by default) |
| SMS | **ACS is external** — not created here; link into Key Vault (see [docs/deploy-azure.md](../docs/deploy-azure.md)) |

## Layout

```
infra/
  main.bicep                 # orchestration (resource-group scope)
  modules/
    monitoring.bicep         # Log Analytics + App Insights
    postgres.bicep           # Flexible Server + DB + Azure-services firewall
    keyvault.bicep           # secrets + RBAC
    redis.bicep              # optional Basic C0
    container-apps.bicep     # CAE + API container
  environments/
    pilot.bicepparam         # non-secret pilot defaults
```

## Validate locally (no Azure login)

```bash
# Install Bicep CLI once: https://aka.ms/bicep-install
az bicep build --file infra/main.bicep
# or
bicep build infra/main.bicep
```

CI also compiles Bicep on PRs (see `.github/workflows/ci.yml`) without Azure credentials.

## Deploy

Full prerequisites, ACS linking, env vars, and first-deploy steps: **[docs/deploy-azure.md](../docs/deploy-azure.md)**.

Manual GitHub Actions deploy: **Actions → Deploy Azure (West Europe) → Run workflow** (`.github/workflows/deploy-azure.yml`).

## Out of scope (this slice)

- Live Azure subscription / credentials in CI
- Private VNet / Private Link (public + Azure-services firewall for pilot)
- Provisioning ACS (ops track — existing resource)
- North Europe HA / geo-redundant Postgres
