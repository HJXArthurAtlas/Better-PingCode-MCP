#!/usr/bin/env node
'use strict';

const { runMcpServer } = require('../src/mcp-server');
const { runCli } = require('../src/cli');

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--mcp')) {
    await runMcpServer();
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    const pkg = require('../package.json');
    console.log(pkg.version);
    process.exit(0);
  }

  await runCli(argv);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
