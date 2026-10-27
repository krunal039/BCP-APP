@description('Azure Container Apps environment + API container (West Europe).')
param namePrefix string
param location string = resourceGroup().location
param tags object = {}

param logAnalyticsCustomerId string
@secure()
param logAnalyticsSharedKey string

param appInsightsConnectionString string

@description('Full image reference, e.g. myacr.azurecr.io/bcp-api:sha')
param containerImage string

@description('ACR login server (optional — required when pulling private images).')
param acrLoginServer string = ''

@description('User-assigned managed identity resource ID.')
param identityId string

@description('Key Vault secret URIs (versionless OK).')
param databaseUrlSecretUri string
param jwtSecretSecretUri string
param acsConnectionStringSecretUri string = ''
param acsPhoneNumberSecretUri string = ''
param acsWebhookSecretSecretUri string = ''

@description('When true, mount ACS_* secret refs so the API uses live ACS SMS. Keep false until Key Vault has real ACS values (otherwise stub DeliveryPort).')
param wireAcsSecrets bool = false

@description('Min replicas (use 1 for always-on pilot API).')
param minReplicas int = 1

@description('Max replicas for MVP pilot.')
param maxReplicas int = 3

@description('CPU cores for the API container.')
param cpu string = '0.5'

@description('Memory for the API container.')
param memory string = '1Gi'

var baseSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: databaseUrlSecretUri
    identity: identityId
  }
  {
    name: 'jwt-secret'
    keyVaultUrl: jwtSecretSecretUri
    identity: identityId
  }
]

var acsSecrets = [
  {
    name: 'acs-connection-string'
    keyVaultUrl: acsConnectionStringSecretUri
    identity: identityId
  }
  {
    name: 'acs-phone-number'
    keyVaultUrl: acsPhoneNumberSecretUri
    identity: identityId
  }
  {
    name: 'acs-webhook-secret'
    keyVaultUrl: acsWebhookSecretSecretUri
    identity: identityId
  }
]

var baseEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '3001' }
  { name: 'HOST', value: '0.0.0.0' }
  { name: 'LOG_LEVEL', value: 'info' }
  { name: 'JWT_EXPIRES_IN', value: '8h' }
  {
    name: 'DATABASE_URL'
    secretRef: 'database-url'
  }
  {
    name: 'JWT_SECRET'
    secretRef: 'jwt-secret'
  }
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsightsConnectionString
  }
]

var acsEnv = [
  {
    name: 'ACS_CONNECTION_STRING'
    secretRef: 'acs-connection-string'
  }
  {
    name: 'ACS_PHONE_NUMBER'
    secretRef: 'acs-phone-number'
  }
  {
    name: 'ACS_WEBHOOK_SECRET'
    secretRef: 'acs-webhook-secret'
  }
]

resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'auto'
        allowInsecure: false
      }
      registries: !empty(acrLoginServer) ? [
        {
          server: acrLoginServer
          identity: identityId
        }
      ] : []
      secrets: concat(baseSecrets, wireAcsSecrets ? acsSecrets : [])
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: concat(baseEnv, wireAcsSecrets ? acsEnv : [])
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output environmentId string = containerEnv.id
output environmentName string = containerEnv.name
output apiAppId string = apiApp.id
output apiAppName string = apiApp.name
output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
