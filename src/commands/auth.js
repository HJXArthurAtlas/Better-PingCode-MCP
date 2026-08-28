'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const core = require('../core');
const shared = require('./shared');

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:8765/callback';
const DEFAULT_PORT = 8765;

const LOGIN_STRING_FLAGS = {
  '--client-id': 'client_id',
  '--client-secret': 'client_secret',
  '--redirect-uri': 'redirect_uri',
  '--code': 'code',
  '--grant-type': 'grant_type',
};

function parseLoginArgs(tokens) {
  const opts = {
    client_id: null,
    client_secret: null,
    redirect_uri: DEFAULT_REDIRECT_URI,
    code: null,
    grant_type: 'authorization_code',
    browser: false,
    port: DEFAULT_PORT,
    no_token_cache: false,
    base_url: process.env.PINGCODE_BASE_URL || core.DEFAULT_BASE_URL,
    token_cache: process.env.PINGCODE_NO_TOKEN_CACHE ? null : core.DEFAULT_TOKEN_CACHE,
  };
  let helpRequested = false;
  const remaining = [];

  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg === '--help' || arg === '-h') {
      helpRequested = true;
      continue;
    }
    if (arg === '--browser') {
      opts.browser = true;
      continue;
    }
    if (arg === '--no-browser') {
      opts.browser = false;
      continue;
    }
    if (arg === '--no-token-cache') {
      opts.no_token_cache = true;
      opts.token_cache = null;
      continue;
    }
    if (arg in LOGIN_STRING_FLAGS) {
      if (i + 1 >= tokens.length) throw new core.PingCodeError(`Option ${arg} requires a value`);
      opts[LOGIN_STRING_FLAGS[arg]] = tokens[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flag = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (flag in LOGIN_STRING_FLAGS) {
          opts[LOGIN_STRING_FLAGS[flag]] = value;
          continue;
        }
      }
      if (arg === '--port') {
        if (i + 1 >= tokens.length) throw new core.PingCodeError('Option --port requires a value');
        const parsed = Number(tokens[i + 1]);
        if (Number.isNaN(parsed)) throw new core.PingCodeError('Invalid port');
        opts.port = parsed;
        i += 1;
        continue;
      }
    }
    remaining.push(arg);
  }

  return { opts, helpRequested, remaining };
}

function createClient(opts) {
  return new core.PingCodeClient({
    base_url: opts.base_url,
    client_id: opts.client_id,
    client_secret: opts.client_secret,
    token_cache: opts.no_token_cache ? null : opts.token_cache,
    workspace_cache: null,
    grant_type: opts.grant_type,
  });
}

async function openBrowser(url) {
  const platform = os.platform();
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], { stdio: 'ignore', shell: platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new core.PingCodeError(`Browser exited with code ${code}`));
    });
  });
}

function promptForCode(inputFunc) {
  const ask = inputFunc || ((prompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(prompt, (answer) => { rl.close(); resolve(answer); }));
  });
  return ask('Paste the authorization code: ');
}

function extractCallbackPath(redirectUri) {
  try {
    const url = new URL(redirectUri);
    return url.pathname || '/callback';
  } catch (_) {
    return '/callback';
  }
}

async function runLogin(argv, inputFunc) {
  const tokens = argv || [];
  if (tokens.length === 0) {
    printLoginHelp();
    return;
  }

  const { opts, helpRequested } = parseLoginArgs(tokens);
  if (helpRequested) {
    printLoginHelp();
    return;
  }

  if (!opts.client_id) {
    throw new core.PingCodeError('Missing --client-id. Set PINGCODE_CLIENT_ID or pass --client-id.');
  }
  if (!opts.client_secret) {
    throw new core.PingCodeError('Missing --client-secret. Set PINGCODE_CLIENT_SECRET or pass --client-secret.');
  }

  const client = createClient(opts);
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = client.buildAuthorizationUrl(opts.redirect_uri, state);
  const callbackPath = extractCallbackPath(opts.redirect_uri);

  if (opts.browser) {
    try {
      await openBrowser(authUrl);
      console.log('Browser opened. Waiting for callback...');
      const result = await core.startAuthCallbackServer({ port: opts.port, path: callbackPath, state });
      await client.exchangeAuthorizationCode(result.code, opts.redirect_uri);
      console.log('User token saved.');
    } catch (exc) {
      console.log(`Browser flow failed: ${exc.message}`);
      console.log('Open this URL in your browser to authorize:');
      console.log(authUrl);
      const code = await promptForCode(inputFunc);
      if (!code) throw new core.PingCodeError('No authorization code provided');
      await client.exchangeAuthorizationCode(code, opts.redirect_uri);
      console.log('User token saved.');
    }
  } else {
    console.log('Open this URL in your browser to authorize:');
    console.log(authUrl);
    const code = opts.code || await promptForCode(inputFunc);
    if (!code) throw new core.PingCodeError('No authorization code provided');
    await client.exchangeAuthorizationCode(code, opts.redirect_uri);
    console.log('User token saved.');
  }
}

function parseStatusArgs(tokens) {
  const parsed = shared.parseGlobalOptions(tokens, []);
  let helpRequested = false;
  const remaining = [];
  for (const arg of parsed.remaining) {
    if (arg === '--help' || arg === '-h') {
      helpRequested = true;
    } else {
      remaining.push(arg);
    }
  }
  return { opts: parsed.opts, helpRequested, remaining };
}

async function runStatus(argv) {
  const tokens = argv || [];
  if (tokens.length === 1 && (tokens[0] === '--help' || tokens[0] === '-h')) {
    printStatusHelp();
    return;
  }

  const { opts, helpRequested } = parseStatusArgs(tokens);
  if (helpRequested) {
    printStatusHelp();
    return;
  }

  const client = shared.clientFromOpts(opts);
  const tokenCachePath = client.tokenCache;
  const workspaceCachePath = client.workspaceCachePath;

  let rawToken = null;
  let validToken = null;
  if (tokenCachePath) {
    rawToken = core.readRawTokenCache(tokenCachePath);
    validToken = core.loadCachedToken(tokenCachePath);
  }

  const hasExplicitToken = typeof opts.token === 'string' && opts.token;
  const tokenValid = !!hasExplicitToken || (validToken !== null);
  const tokenCacheExists = tokenCachePath ? fs.existsSync(tokenCachePath) : false;
  const workspaceCacheExists = workspaceCachePath ? fs.existsSync(workspaceCachePath) : false;
  const grantType = tokenValid
    ? client.resolveGrantType()
    : (rawToken && typeof rawToken.grant_type === 'string' ? rawToken.grant_type : opts.grant_type);

  const expiresAt = rawToken && typeof rawToken.expires_at === 'number' ? rawToken.expires_at : null;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresIn = expiresAt && expiresAt > nowSeconds ? expiresAt - nowSeconds : null;

  const result = {
    authenticated: tokenValid,
    grant_type: grantType,
    base_url: client.baseUrl,
    token_cache: tokenCachePath,
    token_cache_exists: tokenCacheExists,
    token_valid: tokenValid,
    token_expires_at: expiresAt,
    token_expires_in: expiresIn,
    credentials: {
      client_id_configured: !!(opts.client_id || process.env.PINGCODE_CLIENT_ID),
      client_secret_configured: !!(opts.client_secret || process.env.PINGCODE_CLIENT_SECRET),
    },
    workspace_cache: workspaceCachePath,
    workspace_cache_exists: workspaceCacheExists,
  };

  if (opts.dry_run) result.dry_run = true;
  core.printJson(opts.compact ? {
    authenticated: result.authenticated,
    grant_type: result.grant_type,
    token_valid: result.token_valid,
    credentials: result.credentials,
  } : result);
}

function printLoginHelp() {
  console.log([
    'pingcode auth login — Authenticate with PingCode',
    '',
    'Usage: pingcode auth login [options]',
    '',
    'Options:',
    '  --client-id ID          OAuth client ID (or env PINGCODE_CLIENT_ID)',
    '  --client-secret SECRET  OAuth client secret (or env PINGCODE_CLIENT_SECRET)',
    '  --browser               Open browser automatically',
    '  --no-browser            Print URL and prompt for code (default)',
    '  --redirect-uri URL      OAuth redirect URI (default: http://127.0.0.1:8765/callback)',
    '  --code CODE             Paste authorization code directly',
    '  --no-token-cache        Do not cache the token',
    '  --base-url URL          PingCode base URL',
    '',
    'Examples:',
    '  pingcode auth login --client-id ID --client-secret SECRET',
    '  pingcode auth login --client-id ID --client-secret SECRET --browser',
  ].join('\n'));
}

function printStatusHelp() {
  console.log([
    'pingcode auth status — Show authentication status',
    '',
    'Usage: pingcode auth status [options]',
    '',
    'Options:',
    '  --compact               Compact output',
    '  --dry-run               Show what would be checked',
    '',
    'The token value is never printed.',
  ].join('\n'));
}

function printHelp() {
  console.log([
    'pingcode auth — Authenticate with PingCode',
    '',
    'Subcommands:',
    '  status   Show authentication status',
    '',
    'Run `pingcode auth <subcommand> --help` for details.',
  ].join('\n'));
}

async function run(argv, inputFunc) {
  const tokens = argv || [];
  if (tokens.length === 0 || tokens[0] === '--help' || tokens[0] === '-h') {
    printHelp();
    return;
  }
  const subcommand = tokens[0];
  const remaining = tokens.slice(1);
  switch (subcommand) {
    case 'status':
      await runStatus(remaining);
      break;
    default:
      throw new core.PingCodeError(`Unknown auth subcommand: ${subcommand}`);
  }
}

shared.registerModule('auth', {
  name: 'auth',
  description: 'Authenticate with PingCode',
  run,
});

module.exports = { run, runLogin, runStatus, printHelp, printLoginHelp, printStatusHelp, parseLoginArgs };
