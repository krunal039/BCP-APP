# Infra (E1)

Azure resources for BCP Critical Notifications will live here (Bicep preferred).

**Region:** West Europe for Postgres / PII and primary deploy. North Europe is reserved for HA / failover later — not provisioned in MVP unless required.

Planned resources (see Project build plan §4):

- Resource group + managed identity
- Postgres Flexible Server
- Key Vault
- Application Insights
- Container Apps environment
- Azure Communication Services (SMS)
- Redis (or Postgres SKIP LOCKED interim)

Scaffold only in E0 — no cloud resources are created by this PR.
