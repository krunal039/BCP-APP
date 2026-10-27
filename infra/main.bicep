targetScope = 'resourceGroup'

@description('Short name prefix for resources (lowercase alphanumeric / hyphen). Example: bcp-pilot')
@minLength(3)
@maxLength(20)
param namePrefix string = 'bcp-pilot'

@description('Azure region. Locked to West Europe for Postgres / PII + primary deploy.')
@allowed(['westeurope'])
param location string = 'westeurope'

@description('Common resource tags.')
param tags object = {
  project: 'bcp-critical-notifications'
  environment: 'pilot'
  region: 'westeurope'
}

@description('Postgres admin login.')
param postgresAdminLogin string = 'bcpadmin'

@secure()
@description('Postgres admin password (deploy-time secret; also used to build DATABASE_URL).')
param postgresAdminPassword string

@secure()
@description('JWT HMAC secret for the API (min 32 chars).')
param jwtSecret string

@secure()
@description('Optional ACS connection string. Prefer leaving empty and updating Key Vault after ACS is provisioned externally — see docs/deploy-azure.md.')
param acsConnectionString string = ''

@secure()
@description('Optional ACS E.164 from-number. Prefer Key Vault update after ACS link.')
param acsPhoneNumber string = ''

@secure()
@description('Optional ACS webhook shared secret.')
param acsWebhookSecret string = ''

@description('Provision Azure Cache for Redis (Basic C0). Set false for ultra-lean pilot (Postgres SKIP LOCKED interim).')
param enableRedis bool = false

@description('Container image for the API. Use a public placeholder on first infra deploy; CI overwrites with ACR image.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Create an Azure Container Registry in this stack (recommended for pilot).')
param createAcr bool = true

@description('Existing ACR login server when createAcr=false (e.g. myregistry.azurecr.io).')
param existingAcrLoginServer string = ''

@description('Object ID of the GitHub Actions / deployer service principal for Key Vault Secrets Officer (optional).')
param deployerObjectId string = ''

@description('API min replicas (1 keeps /health warm for pilot).')
param apiMinReplicas int = 1

@description('Mount ACS_* Key Vault secret refs on the Container App. Keep false until Key Vault has real ACS values so the API stays on stub DeliveryPort.')
param wireAcsSecrets bool = false

// --- Identity (Container Apps → Key Vault + ACR) ---
resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-api-id'
  location: location
  tags: tags
}

// --- Monitoring ---
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    namePrefix: namePrefix
    location: location
    tags: tags
  }
}

// --- Postgres ---
module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    namePrefix: namePrefix
    location: location
    tags: tags
    administratorLogin: postgresAdminLogin
    administratorPassword: postgresAdminPassword
    databaseName: 'bcp'
    allowAzureServices: true
  }
}

// --- Key Vault (secret placeholders; ACS filled after external ACS link) ---
module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    namePrefix: namePrefix
    location: location
    tags: tags
    databaseUrl: '${postgres.outputs.connectionString}&schema=public'
    jwtSecret: jwtSecret
    acsConnectionString: acsConnectionString
    acsPhoneNumber: acsPhoneNumber
    acsWebhookSecret: acsWebhookSecret
    deployerObjectId: deployerObjectId
    apiIdentityPrincipalId: apiIdentity.properties.principalId
  }
}

// --- Optional Redis ---
module redis 'modules/redis.bicep' = if (enableRedis) {
  name: 'redis'
  params: {
    namePrefix: namePrefix
    location: location
    tags: tags
  }
}

// --- ACR (optional create) ---
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = if (createAcr) {
  name: take('${replace(namePrefix, '-', '')}acr${uniqueString(resourceGroup().id)}', 50)
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createAcr) {
  name: guid(acr.id, apiIdentity.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
    )
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

var acrLoginServer = createAcr ? acr!.properties.loginServer : existingAcrLoginServer

// --- Container Apps ---
module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps'
  params: {
    namePrefix: namePrefix
    location: location
    tags: tags
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: monitoring.outputs.logAnalyticsPrimarySharedKey
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    containerImage: containerImage
    acrLoginServer: acrLoginServer
    identityId: apiIdentity.id
    databaseUrlSecretUri: keyVault.outputs.databaseUrlSecretUri
    jwtSecretSecretUri: keyVault.outputs.jwtSecretSecretUri
    acsConnectionStringSecretUri: keyVault.outputs.acsConnectionStringSecretUri
    acsPhoneNumberSecretUri: keyVault.outputs.acsPhoneNumberSecretUri
    acsWebhookSecretSecretUri: keyVault.outputs.acsWebhookSecretSecretUri
    wireAcsSecrets: wireAcsSecrets
    minReplicas: apiMinReplicas
  }
  dependsOn: [
    acrPull
  ]
}

// --- Outputs ---
output resourceGroup string = resourceGroup().name
output location string = location
output apiUrl string = containerApps.outputs.apiUrl
output apiFqdn string = containerApps.outputs.apiFqdn
output apiAppName string = containerApps.outputs.apiAppName
output containerAppsEnvironmentName string = containerApps.outputs.environmentName
output keyVaultName string = keyVault.outputs.keyVaultName
output keyVaultUri string = keyVault.outputs.keyVaultUri
output postgresFqdn string = postgres.outputs.fullyQualifiedDomainName
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output acrLoginServer string = acrLoginServer
output apiIdentityClientId string = apiIdentity.properties.clientId
output apiIdentityPrincipalId string = apiIdentity.properties.principalId
output redisEnabled bool = enableRedis
output redisHostName string = enableRedis ? redis!.outputs.redisHostName : ''

output acsLinkReminder string = 'ACS is NOT provisioned by this stack. Store ACS connection string + phone in Key Vault secrets acs-connection-string and acs-phone-number. See docs/deploy-azure.md.'
