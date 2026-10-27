@description('Key Vault for API secrets. ACS connection string / phone are stored here after provisioning ACS outside this stack.')
param namePrefix string
param location string = resourceGroup().location
param tags object = {}
param tenantId string = subscription().tenantId

@secure()
@description('Postgres connection string for the API (DATABASE_URL).')
param databaseUrl string

@secure()
@description('JWT HMAC secret (min 32 chars).')
param jwtSecret string

@secure()
@description('ACS connection string. Leave empty placeholder until ACS is linked (see docs/deploy-azure.md).')
param acsConnectionString string = ''

@secure()
@description('ACS from-number (E.164). Leave empty until ACS is linked.')
param acsPhoneNumber string = ''

@secure()
@description('Optional shared secret for ACS delivery webhooks.')
param acsWebhookSecret string = ''

@description('Object ID of the principal that may set secrets at deploy time (deployer / CI SP). Optional.')
param deployerObjectId string = ''

@description('Principal ID of the Container App managed identity (Key Vault Secrets User).')
param apiIdentityPrincipalId string = ''

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('${replace(namePrefix, '-', '')}kv${uniqueString(resourceGroup().id)}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enablePurgeProtection: false
    publicNetworkAccess: 'Enabled'
  }
}

resource databaseUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'database-url'
  properties: {
    value: databaseUrl
  }
}

resource jwtSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'jwt-secret'
  properties: {
    value: jwtSecret
  }
}

resource acsConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'acs-connection-string'
  properties: {
    // Placeholder until ops pastes the real ACS connection string (external resource).
    value: empty(acsConnectionString) ? 'REPLACE_WITH_ACS_CONNECTION_STRING' : acsConnectionString
  }
}

resource acsPhoneNumberSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'acs-phone-number'
  properties: {
    value: empty(acsPhoneNumber) ? 'REPLACE_WITH_ACS_E164' : acsPhoneNumber
  }
}

resource acsWebhookSecretSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'acs-webhook-secret'
  properties: {
    value: empty(acsWebhookSecret) ? 'REPLACE_WITH_ACS_WEBHOOK_SECRET' : acsWebhookSecret
  }
}

// Optional: grant the deploy principal Secrets Officer so CI / local az can rotate values.
resource deployerSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerObjectId)) {
  name: guid(keyVault.id, deployerObjectId, 'Key Vault Secrets Officer')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b86a8fe4-44ce-4948-aee5-eccb2c3cd7cf' // Key Vault Secrets Officer
    )
    principalId: deployerObjectId
    principalType: 'ServicePrincipal'
  }
}

resource apiSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(apiIdentityPrincipalId)) {
  name: guid(keyVault.id, apiIdentityPrincipalId, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
    )
    principalId: apiIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output databaseUrlSecretUri string = '${keyVault.properties.vaultUri}secrets/database-url'
output jwtSecretSecretUri string = '${keyVault.properties.vaultUri}secrets/jwt-secret'
output acsConnectionStringSecretUri string = '${keyVault.properties.vaultUri}secrets/acs-connection-string'
output acsPhoneNumberSecretUri string = '${keyVault.properties.vaultUri}secrets/acs-phone-number'
output acsWebhookSecretSecretUri string = '${keyVault.properties.vaultUri}secrets/acs-webhook-secret'
