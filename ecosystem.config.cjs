module.exports = {
  apps: [{
    name: "gym",
    script: "server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    env: {
      NODE_ENV: "production",
    },
  }]
};