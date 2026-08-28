'use strict';

const core = require('../core');

const registry = new Map();

function registerModule(name, config) {
  registry.set(name, config);
}

function getModule(name) {
  return registry.get(name);
}

function listModules() {
  const modules = [];
  for (const [name, config] of registry) {
    modules.push({ name, description: config.description });
  }
  modules.sort((a, b) => a.name.localeCompare(b.name));
  return modules;
}

function printModulesHelp() {
  const modules = listModules();
  const maxLen = Math.max(...modules.map((m) => m.name.length), 10);
  const lines = ['Usage: pingcode <module> <subcommand> [options]', ''];
  lines.push('Modules:');
  for (const m of modules) {
    lines.push(`  ${m.name.padEnd(maxLen)}  ${m.description}`);
  }
  lines.push('');
  lines.push('Global options:');
  lines.push('  --base-url URL          PingCode base URL');
  lines.push('  --client-id ID          OAuth client ID');
  lines.push('  --client-secret SECRET  OAuth client secret');
  lines.push('  --token TOKEN           Bearer token (skip OAuth)');
  lines.push('  --user-id ID            Current user ID');
  lines.push('  --user-name NAME        Current user name');
  lines.push('  --workspace-cache PATH  Workspace cache file path');
  lines.push('  --no-workspace-cache    Disable workspace cache');
  lines.push('  --no-token-cache        Disable token cache');
  lines.push('  --dry-run               Show API request without executing');
  lines.push('  --compact               Compact output');
  lines.push('  --grant-type TYPE       OAuth grant type: client_credentials, authorization_code, or auto');
  lines.push('  --version               Show version');
  lines.push('  --help                  Show this help');
  console.log(lines.join('\n'));
}

const BASE_GLOBAL_BOOLEAN_FLAGS = new Set([
  '--dry-run', '--compact', '--no-token-cache', '--no-workspace-cache',
]);

const BASE_GLOBAL_STRING_FLAGS = {
  '--base-url': 'base_url',
  '--client-id': 'client_id',
  '--client-secret': 'client_secret',
  '--token': 'token',
  '--user-id': 'user_id',
  '--user-name': 'user_name',
  '--workspace-cache': 'workspace_cache',
  '--grant-type': 'grant_type',
};

function defaultGlobalOpts(extraBooleanFlags = []) {
  return {
    base_url: process.env.PINGCODE_BASE_URL || core.DEFAULT_BASE_URL,
    client_id: process.env.PINGCODE_CLIENT_ID || null,
    client_secret: process.env.PINGCODE_CLIENT_SECRET || null,
    token: process.env.PINGCODE_TOKEN || null,
    user_id: process.env.PINGCODE_USER_ID || null,
    user_name: process.env.PINGCODE_USER_NAME || null,
    workspace_cache: core.DEFAULT_WORKSPACE_CACHE,
    token_cache: process.env.PINGCODE_NO_TOKEN_CACHE ? null : core.DEFAULT_TOKEN_CACHE,
    dry_run: false,
    compact: false,
    grant_type: 'auto',
  };
}

function parseGlobalOptions(tokens, extraBooleanFlags = []) {
  const opts = defaultGlobalOpts(extraBooleanFlags);
  const remaining = [];
  const booleanFlags = new Set([...BASE_GLOBAL_BOOLEAN_FLAGS, ...extraBooleanFlags]);

  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg === '--help' || arg === '-h') {
      remaining.push(arg);
      continue;
    }
    if (booleanFlags.has(arg)) {
      const key = arg.replace(/^--(?:no-)?/, '').replace(/-/g, '_');
      if (arg.startsWith('--no-')) {
        opts[key] = false;
      } else {
        opts[key] = true;
      }
      continue;
    }
    if (arg in BASE_GLOBAL_STRING_FLAGS) {
      if (i + 1 >= tokens.length) {
        throw new core.PingCodeError(`Option ${arg} requires a value`);
      }
      opts[BASE_GLOBAL_STRING_FLAGS[arg]] = tokens[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flag = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (flag in BASE_GLOBAL_STRING_FLAGS) {
          opts[BASE_GLOBAL_STRING_FLAGS[flag]] = value;
          continue;
        }
      }
    }
    remaining.push(arg);
  }

  return { opts, remaining };
}

function clientFromOpts(opts) {
  const noTokenCache = opts.token_cache === false || opts.no_token_cache === true;
  const noWorkspaceCache = opts.workspace_cache === false || opts.no_workspace_cache === true;
  return new core.PingCodeClient({
    base_url: opts.base_url,
    client_id: opts.client_id,
    client_secret: opts.client_secret,
    token: opts.token,
    token_cache: noTokenCache ? null : opts.token_cache,
    workspace_cache: noWorkspaceCache ? null : opts.workspace_cache,
    grant_type: opts.grant_type,
  });
}

module.exports = {
  registerModule,
  getModule,
  listModules,
  printModulesHelp,
  BASE_GLOBAL_BOOLEAN_FLAGS,
  BASE_GLOBAL_STRING_FLAGS,
  defaultGlobalOpts,
  parseGlobalOptions,
  clientFromOpts,
};
