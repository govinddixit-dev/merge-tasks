module.exports = {
  apps: [
    {
      name: "mergetasks",
      script: "/home/ubuntu/mergetasks/start-server.sh",
      interpreter: "/bin/bash",
      cwd: "/home/ubuntu/mergetasks",
      env: {
        NODE_ENV: "production"
      },
      max_memory_restart: "1G",
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      watch: false
    },
    {
      // Nano-banana render worker. Separate pm2 app so it can crash,
      // restart, or be stopped without affecting the main server. Start
      // with: pm2 start ecosystem.config.cjs --only mergetasks-render-worker
      // (the --only flag scopes pm2 to this entry; do NOT run pm2 start
      //  ecosystem.config.cjs bare — that touches the main app too).
      name: "mergetasks-render-worker",
      script: "/home/ubuntu/mergetasks/start-render-worker.sh",
      interpreter: "/bin/bash",
      cwd: "/home/ubuntu/mergetasks",
      env: {
        NODE_ENV: "production"
      },
      max_memory_restart: "512M",
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      // Must exceed the worker's internal SHUTDOWN_TIMEOUT_MS (30s) so
      // SIGKILL doesn't preempt graceful shutdown of in-flight renders.
      kill_timeout: 35000
    }
  ]
};
