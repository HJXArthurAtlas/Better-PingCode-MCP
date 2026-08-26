'use strict';

const core = require('../core');
const shared = require('./shared');

function printHelp() {
  console.log([
    'pingcode idea — Manage ideas (requirements)',
    '',
    'This command is not yet implemented in brtter-pingcode-mcp.',
  ].join('\n'));
}

async function run(argv) {
  printHelp();
}

shared.registerModule('idea', {
  name: 'idea',
  description: 'Manage ideas (requirements)',
  run,
});

module.exports = { run, printHelp };
