const path = require("node:path");
const { pathToFileURL } = require("node:url");

const tsxLoaderUrl = pathToFileURL(
  path.resolve(__dirname, "node_modules/tsx/dist/loader.mjs")
).href;

module.exports = {
  apps: [{
    name: "gym",
    script: "server.js",
    node_args: `--import ${tsxLoaderUrl}`,
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    env: {
      NODE_ENV: "production",
    },
  }]
};