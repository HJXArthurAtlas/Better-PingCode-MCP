'use strict';

const core = require('../core');
const shared = require('./shared');

function printHelp() {
  console.log([
    'pingcode comment — Manage work-item comments',
    '',
    'This command is not yet implemented in brtter-pingcode-mcp.',
  ].join('\n'));
}

async function run(argv) {
  printHelp();
}

shared.registerModule('comment', {
  name: 'comment',
  description: 'Manage work-item comments',
  run,
});

module.exports = { run, printHelp };
