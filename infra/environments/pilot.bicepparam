using '../main.bicep'

// Pilot parameters for West Europe. Secrets are supplied at deploy time
// (az deployment … --parameters …=…) or via GitHub Actions secrets — never commit real values.

param namePrefix = 'bcp-pilot'
param location = 'westeurope'
param tags = {
  project: 'bcp-critical-notifications'
  environment: 'pilot'
  region: 'westeurope'
}

param postgresAdminLogin = 'bcpadmin'
// Provide at deploy time:
//   postgresAdminPassword=<strong-password>
//   jwtSecret=<min-32-char-secret>
param enableRedis = false
param createAcr = true
param wireAcsSecrets = false
param apiMinReplicas = 1

// First infra deploy can use the public quickstart image; CI then pushes bcp-api to ACR
// and redeploys with containerImage=<acrLoginServer>/bcp-api:<tag>.
param containerImage = 'mcr.microsoft.com/k8se/quickstart:latest'
