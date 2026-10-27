@description('Optional Azure Cache for Redis (Basic C0) — job queue backing for fan-out at scale. Disable for ultra-lean pilot (Postgres SKIP LOCKED interim).')
param namePrefix string
param location string = resourceGroup().location
param tags object = {}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: take('${namePrefix}-redis-${uniqueString(resourceGroup().id)}', 63)
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    redisConfiguration: {
      'maxmemory-policy': 'volatile-lru'
    }
  }
}

output redisId string = redis.id
output redisHostName string = redis.properties.hostName
output redisSslPort int = redis.properties.sslPort
// Primary key intentionally not exported — read via `az redis list-keys` when wiring a worker.
