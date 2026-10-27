@description('Log Analytics workspace + Application Insights for the API (West Europe).')
param namePrefix string
param location string = resourceGroup().location
param tags object = {}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output logAnalyticsId string = logAnalytics.id
output logAnalyticsName string = logAnalytics.name
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
#disable-next-line outputs-should-not-contain-secrets
output logAnalyticsPrimarySharedKey string = logAnalytics.listKeys().primarySharedKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsId string = appInsights.id
