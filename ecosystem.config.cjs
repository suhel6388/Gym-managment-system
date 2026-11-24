const fs = require("node:fs");
const path = require("node:path");

const envPath = path.resolve(__dirname, ".env");
const nodeArgs = fs.existsSync(envPath) ? ["--env-file=.env"] : [];

module.exports = {
  apps: [{
    name: "gym",
    script: "server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    node_args: nodeArgs,
    env: {
      NODE_ENV: "production",
    },
  }]
};
