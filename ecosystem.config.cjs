module.exports = {
  apps: [
    {
      name: "server",
      script: "npm",
      args: "run start:pm2",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
    },
  ],
};
