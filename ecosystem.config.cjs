module.exports = {
  apps: [
    {
      name: "server",
      script: "npm",
      args: "start",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
