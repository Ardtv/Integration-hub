module.exports = {
  apps: [
    {
      name: 'hub',
      script: 'npm',
      args: 'start',
      cwd: '/root/integration-hub',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      max_restarts: 10,
      restart_delay: 3000
    },
    {
      name: 'amo-connector',
      script: 'node',
      args: 'connectors/amo/webhook-server.js',
      cwd: '/root/integration-hub',
      env: {
        NODE_ENV: 'production'
      },
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
