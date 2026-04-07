module.exports = {
  apps: [
    {
      name: "opencode",
      script: "opencode",
      args: "web --port 4096",
      interpreter: "none",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: "weixin-claw",
      script: "dist/cli/index.js",
      args: "agent",
      interpreter: "node",
      node_args: "--enable-source-maps",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      wait_ready: false,
      depends_on: ["opencode"],
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
