'use strict';

const readline = require('node:readline');

const core = require('../core');
const shared = require('./shared');
const authCmd = require('./auth');
const mcpCmd = require('./mcp');

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8765/callback';
const DEFAULT_PORT = 8765;

function createAsk(inputFunc) {
  if (typeof inputFunc === 'function') {
    return inputFunc;
  }
  if (Array.isArray(inputFunc)) {
    const queue = [...inputFunc];
    return async (prompt) => {
      const next = queue.shift();
      if (next === undefined) {
        throw new core.PingCodeError(`Unexpected prompt (no queued answer): ${prompt}`);
      }
      return next;
    };
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));
  ask._rl = rl;
  return ask;
}

function closeAsk(ask) {
  if (ask && ask._rl) {
    ask._rl.close();
  }
}

function parseInitArgs(tokens) {
  const { opts, remaining } = shared.parseGlobalOptions(tokens, [
    '--all', '--yes', '--browser', '--dry-run', '--no-token-cache',
  ]);
  const tools = [];
  let helpRequested = false;

  for (let i = 0; i < remaining.length; i += 1) {
    const arg = remaining[i];
    if (arg === '--help' || arg === '-h') {
      helpRequested = true;
      continue;
    }
    if (arg === '--tool') {
      if (i + 1 >= remaining.length) {
        throw new core.PingCodeError('Option --tool requires a value');
      }
      tools.push(remaining[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--tool=')) {
      tools.push(arg.slice('--tool='.length));
      continue;
    }
    if (arg === '--redirect-uri') {
      if (i + 1 >= remaining.length) {
        throw new core.PingCodeError('Option --redirect-uri requires a value');
      }
      opts.redirect_uri = remaining[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--code') {
      if (i + 1 >= remaining.length) {
        throw new core.PingCodeError('Option --code requires a value');
      }
      opts.code = remaining[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--port') {
      if (i + 1 >= remaining.length) {
        throw new core.PingCodeError('Option --port requires a value');
      }
      const parsed = Number(remaining[i + 1]);
      if (Number.isNaN(parsed)) {
        throw new core.PingCodeError('Invalid port');
      }
      opts.port = parsed;
      i += 1;
      continue;
    }
    throw new core.PingCodeError(`Unknown option: ${arg}`);
  }

  opts.tool = tools;
  if (!opts.redirect_uri) opts.redirect_uri = DEFAULT_REDIRECT_URI;
  if (!opts.port) opts.port = DEFAULT_PORT;
  return { opts, helpRequested };
}

async function runLoginIfNeeded(opts, clientId, clientSecret, inputFunc) {
  if (opts.dry_run) return;

  const tokenCachePath = core.expandUserPath(core.DEFAULT_TOKEN_CACHE);
  let tokenValid = false;
  try {
    tokenValid = !!core.loadCachedToken(tokenCachePath);
  } catch (_) {
    tokenValid = false;
  }

  if (tokenValid) {
    console.log('Using cached PingCode token.');
    return;
  }

  console.log('Trying client_credentials authentication...');
  try {
    const client = new core.PingCodeClient({
      base_url: opts.base_url,
      client_id: clientId,
      client_secret: clientSecret,
      token_cache: opts.no_token_cache ? null : opts.token_cache,
      workspace_cache: null,
      grant_type: 'client_credentials',
    });
    await client.accessToken();
    console.log('Authenticated with client_credentials.');
    return;
  } catch (exc) {
    const message = exc.message || '';
    const invalidCredsMatch = message.match(/"code"\s*:\s*"100024"/);
    if (invalidCredsMatch) {
      throw new core.PingCodeError('Invalid PingCode Client ID or Client Secret. Please check your credentials.');
    }
  }

  const loginArgs = ['--client-id', clientId, '--client-secret', clientSecret, '--redirect-uri', opts.redirect_uri, '--browser', '--grant-type', 'authorization_code'];
  if (opts.code) loginArgs.push('--code', opts.code);
  if (opts.port) loginArgs.push('--port', String(opts.port));
  if (opts.no_token_cache) loginArgs.push('--no-token-cache');

  await authCmd.runLogin(loginArgs, inputFunc);
}

async function run(argv, inputFunc) {
  const parsed = parseInitArgs(argv || []);
  if (parsed.helpRequested) {
    printHelp();
    return;
  }

  const ask = createAsk(inputFunc);
  try {
    const clientId = (parsed.opts.client_id || (await ask('PingCode Client ID: '))).trim();
    const clientSecret = (parsed.opts.client_secret || (await ask('PingCode Client Secret: '))).trim();
    if (!clientId) {
      throw new core.PingCodeError('Missing PingCode Client ID');
    }
    if (!clientSecret) {
      throw new core.PingCodeError('Missing PingCode Client Secret');
    }

    await runLoginIfNeeded(parsed.opts, clientId, clientSecret, inputFunc);

    const mcpArgv = ['--client-id', clientId, '--client-secret', clientSecret];
    if (parsed.opts.base_url && parsed.opts.base_url !== core.DEFAULT_BASE_URL) {
      mcpArgv.push('--base-url', parsed.opts.base_url);
    }
    if (parsed.opts.all) mcpArgv.push('--all');
    for (const tool of parsed.opts.tool) {
      mcpArgv.push('--tool', tool);
    }
    if (parsed.opts.yes) mcpArgv.push('--yes');
    if (parsed.opts.dry_run) mcpArgv.push('--dry-run');

    await mcpCmd.runInit(mcpArgv, inputFunc);
  } finally {
    closeAsk(ask);
  }
}

function printHelp() {
  console.log([
    'pingcode init — Initialize PingCode authentication and MCP clients',
    '',
    'Usage: pingcode init [options]',
    '',
    'Options:',
    '  --client-id ID          PingCode OAuth client ID',
    '  --client-secret SECRET  PingCode OAuth client secret',
    '  --base-url URL          PingCode base URL',
    '  --browser               Open browser automatically for login',
    '  --redirect-uri URL      OAuth redirect URI (default: http://127.0.0.1:8765/callback)',
    '  --code CODE             Paste authorization code directly',
    '  --port PORT             OAuth callback server port',
    '  --no-token-cache        Do not cache the token',
    '  --all                   Configure all supported MCP clients',
    '  --tool <id>             Configure a specific MCP client (can be repeated)',
    '  --yes                   Skip the final confirmation prompt',
    '  --dry-run               Show what would be written without writing',
    '  --help                  Show this help',
    '',
    'Supported MCP clients: codex, opencode, omp',
    '',
    'Examples:',
    '  pingcode init',
    '  pingcode init --client-id ID --client-secret SECRET',
    '  pingcode init --all --yes --client-id ID --client-secret SECRET',
    '  pingcode init --dry-run --client-id ID --client-secret SECRET',
  ].join('\n'));
}

shared.registerModule('init', {
  name: 'init',
  description: 'Initialize PingCode authentication and MCP clients',
  run,
});

module.exports = { run, printHelp, parseInitArgs };
