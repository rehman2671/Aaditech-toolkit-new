/**
 * PM2 Process Manager & Cluster Configuration
 * 
 * HARD PREREQUISITE ARCHITECTURAL NOTE:
 * This enterprise backend is designed to run in multi-instance cluster mode across all CPU cores
 * or in multi-replica container environments behind load balancers.
 * 
 * ALL shared state (sessions, devices, credentials, revoked tokens, commands, policies, audit logs)
 * is authoritatively backed by MySQL and Redis. DO NOT introduce in-process in-memory state or singletons
 * without backing them with the database or distributed cache, or multi-instance deployments will drift
 * and break.
 */
module.exports = {
  apps: [
    {
      name: 'aaditech-toolkit-enterprise',
      script: 'server.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000
      }
    }
  ]
};
