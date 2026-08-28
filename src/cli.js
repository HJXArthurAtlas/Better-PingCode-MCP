'use strict';

const core = require('./core');
const shared = require('./commands/shared');

require('./commands/auth');
require('./commands/context');
require('./commands/workitem');
require('./commands/comment');
require('./commands/attachment');
require('./commands/idea');
require('./commands/init');
require('./commands/product');

async function runCli(argv) {
  const tokens = argv || process.argv.slice(2);

  if (tokens.length === 0 || tokens[0] === '--help' || tokens[0] === '-h') {
    shared.printModulesHelp();
    return;
  }

  const moduleName = tokens[0];
  const mod = shared.getModule(moduleName);
  if (!mod) {
    throw new core.PingCodeError(`Unknown module: ${moduleName}`);
  }

  try {
    await mod.run(tokens.slice(1));
  } catch (exc) {
    if (exc instanceof core.PingCodeError) {
      throw exc;
    }
    throw new core.PingCodeError(exc.message);
  }
}

module.exports = { runCli };
