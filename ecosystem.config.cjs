module.exports = {
  apps: [{
    name: "server",
    script: "server.js",
    interpreter: "./node_modules/.bin/tsx",
    cwd: __dirname,
    instances: 1,
    autorestart: true,
  }]
};