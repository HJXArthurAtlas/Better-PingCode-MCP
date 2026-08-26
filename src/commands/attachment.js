'use strict';

const core = require('../core');
const shared = require('./shared');

function printHelp() {
  console.log([
    'pingcode attachment — Manage attachments',
    '',
    'This command is not yet implemented in brtter-pingcode-mcp.',
  ].join('\n'));
}

async function run(argv) {
  printHelp();
}

shared.registerModule('attachment', {
  name: 'attachment',
  description: 'Manage attachments',
  run,
});

module.exports = { run, printHelp };
