@description('Postgres Flexible Server (West Europe) — lean Burstable SKU for MVP pilot.')
param namePrefix string
param location string = resourceGroup().location
param tags object = {}

@description('Postgres admin login.')
param administratorLogin string = 'bcpadmin'

@secure()
param administratorPassword string

@description('Database name for the API.')
param databaseName string = 'bcp'

@description('Allow Azure services firewall rule (Container Apps egress is Azure-sourced).')
param allowAzureServices bool = true

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: take('${namePrefix}-pg-${uniqueString(resourceGroup().id)}', 63)
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    // MVP pilot: public access + Azure services firewall. Private VNet can land post-pilot.
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource allowAzureFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = if (allowAzureServices) {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

@description('Connection string without schema query — callers append ?schema=public.')
var connectionString = 'postgresql://${administratorLogin}:${administratorPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'

output serverName string = postgres.name
output fullyQualifiedDomainName string = postgres.properties.fullyQualifiedDomainName
output databaseName string = databaseName
output administratorLogin string = administratorLogin
@secure()
output connectionString string = connectionString
