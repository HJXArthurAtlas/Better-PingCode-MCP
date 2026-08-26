'use strict';

const core = require('../core');
const shared = require('./shared');

function printHelp() {
  console.log([
    'pingcode product — Manage products',
    '',
    'This command is not yet implemented in brtter-pingcode-mcp.',
  ].join('\n'));
}

async function run(argv) {
  printHelp();
}

shared.registerModule('product', {
  name: 'product',
  description: 'Manage PingCode products',
  run,
});

module.exports = { run, printHelp };
