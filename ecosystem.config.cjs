module.exports = {
  apps: [{
    name: "gym",
    script: "server.js",
    interpreter: "./node_modules/.bin/tsx",
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    env: {
      NODE_ENV: "production",
    },
  }]
};