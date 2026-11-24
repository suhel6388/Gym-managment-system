module.exports = {
  apps: [{
    name: "gym",
    script: "server.js",
    node_args: "--import tsx",
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    env: {
      NODE_ENV: "production",
    },
  }]
};