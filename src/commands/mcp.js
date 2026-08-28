'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const core = require('../core');
const shared = require('./shared');

// The published package reference used in generated MCP configs.
const PACKAGE_REF = '@arthuratlas/better-pingcode@latest';
const SERVER_NAME = 'pingcode';
const OMP_SCHEMA_URL = 'https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  resetColor: '\x1b[39m',
};

function dim(text) { return `${ANSI.dim}${text}${ANSI.reset}`; }
function bold(text) { return `${ANSI.bold}${text}${ANSI.reset}`; }

const TOOLS = [
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    filePath: () => path.join(os.homedir(), '.codex', 'config.toml'),
    write: writeCodexConfig,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    filePath: () => getOpenCodeConfigPath(),
    write: writeOpenCodeConfig,
  },
  {
    id: 'omp',
    name: 'Oh My Pi',
    filePath: () => path.join(os.homedir(), '.omp', 'agent', 'mcp.json'),
    write: writeOmpConfig,
  },
];

function getOpenCodeConfigPath() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'opencode', 'opencode.json');
  }
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

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

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseJsonFile(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (exc) {
    throw new core.PingCodeError(`Invalid JSON in ${filePath}: ${exc.message}`);
  }
}

function parseJsoncFile(filePath, defaultValue = {}) {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (_) {
    // OpenCode supports JSONC; strip comments and try again.
    const stripped = stripJsonComments(raw);
    try {
      return JSON.parse(stripped);
    } catch (exc) {
      throw new core.PingCodeError(`Invalid JSON/JSONC in ${filePath}: ${exc.message}`);
    }
  }
}

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function writeJsonFile(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function buildStdioEntry(env) {
  const entry = {
    command: 'npx',
    args: ['-y', PACKAGE_REF, '--mcp'],
  };
  if (Object.keys(env).length > 0) {
    entry.env = env;
  }
  return entry;
}

function writeOmpConfig(filePath, env) {
  const config = parseJsonFile(filePath, { $schema: OMP_SCHEMA_URL, mcpServers: {} });
  config.mcpServers = config.mcpServers || {};
  config.mcpServers[SERVER_NAME] = buildStdioEntry(env);
  if (config.$schema === undefined) {
    config.$schema = OMP_SCHEMA_URL;
  }
  writeJsonFile(filePath, config);
}

function writeOpenCodeConfig(filePath, env) {
  const config = parseJsoncFile(filePath, {});
  config.mcp = config.mcp || {};
  config.mcp[SERVER_NAME] = {
    type: 'local',
    command: ['npx', '-y', PACKAGE_REF, '--mcp'],
    enabled: true,
  };
  if (Object.keys(env).length > 0) {
    config.mcp[SERVER_NAME].environment = env;
  }
  writeJsonFile(filePath, config);
}

function tomlString(value) {
  // TOML basic strings are compatible with JSON-stringified simple values.
  return JSON.stringify(value);
}

function tomlStringArray(items) {
  return `[${items.map(tomlString).join(', ')}]`;
}

function buildCodexServerLines(env) {
  const lines = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString('npx')}`,
    `args = ${tomlStringArray(['-y', PACKAGE_REF, '--mcp'])}`,
    `enabled = true`,
  ];
  const envKeys = Object.keys(env);
  if (envKeys.length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${SERVER_NAME}.env]`);
    for (const key of envKeys) {
      lines.push(`${key} = ${tomlString(env[key])}`);
    }
  }
  return lines;
}

function writeCodexConfig(filePath, env) {
  ensureDir(filePath);
  const newLines = buildCodexServerLines(env);

  let raw = '';
  if (fs.existsSync(filePath)) {
    raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const header = `[mcp_servers.${SERVER_NAME}]`;
    const startLine = lines.findIndex((line) => line.trim() === header);
    if (startLine !== -1) {
      let endLine = lines.length;
      for (let i = startLine + 1; i < lines.length; i += 1) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('[') && !trimmed.startsWith(`[mcp_servers.${SERVER_NAME}.`)) {
          endLine = i;
          break;
        }
      }
      const insert = [...newLines];
      if (startLine > 0 && lines[startLine - 1].trim() !== '') {
        insert.unshift('');
      }
      lines.splice(startLine, endLine - startLine, ...insert);
      raw = lines.join('\n');
    } else {
      raw = raw.replace(/\s*$/, '\n');
      raw += '\n' + newLines.join('\n') + '\n';
    }
  } else {
    raw = newLines.join('\n') + '\n';
  }
  fs.writeFileSync(filePath, raw);
}

function parseKey(buf) {
  const s = buf.toString('utf8');
  if (s === '\u0003' || s === '\u0004' || s === 'q' || s === 'Q') return 'cancel';
  if (s === '\r' || s === '\n') return 'confirm';
  if (s === ' ') return 'space';
  if (s === '\u007f') return 'backspace';
  if (s === '\u001b[A' || s === '\u001bOA') return 'up';
  if (s === '\u001b[B' || s === '\u001bOB') return 'down';
  if (/^[\x20-\x7e]$/.test(s) && s !== ' ') return s;
  return null;
}

async function checkboxSelect(label, items, inputFunc) {
  const choices = items.map((it) => ({ id: it.id, name: it.name, selected: false }));

  // Programmatic / test path: inputFunc can return the selected ids directly.
  if (typeof inputFunc === 'function') {
    const result = await inputFunc({ type: 'checkbox', label, items: choices });
    if (!Array.isArray(result)) {
      throw new core.PingCodeError('checkbox inputFunc must return an array of ids');
    }
    return result;
  }

  // Non-TTY fallback: simple y/n per item.
  if (!process.stdin.isTTY) {
    const ask = createAsk(inputFunc);
    const selected = [];
    for (const choice of choices) {
      const answer = await ask(`${label}: ${choice.name}? (y/N): `);
      if (isYes(answer)) {
        selected.push(choice.id);
        choice.selected = true;
      }
    }
    return selected;
  }

  return new Promise((resolve, reject) => {
    let index = 0;
    let query = '';
    let linesCount = 0;

    function cleanup() {
      try {
        process.stdin.setRawMode(false);
      } catch (_) {}
      process.stdin.pause();
      process.stdout.write('\x1b[?25h'); // show cursor
    }

    function removeListener() {
      process.stdin.removeListener('data', onData);
    }

    function filteredChoices() {
      if (!query) return choices;
      const q = query.toLowerCase();
      return choices.filter((c) => c.name.toLowerCase().includes(q));
    }

    function selectedNames() {
      const names = choices.filter((c) => c.selected).map((c) => c.name);
      return names.length > 0 ? names.join(', ') : '(none selected)';
    }

    function render() {
      const visible = filteredChoices();
      if (index >= visible.length) {
        index = visible.length > 0 ? visible.length - 1 : 0;
      }
      if (linesCount > 0) {
        process.stdout.write(`\x1b[${linesCount}A\r\x1b[J`);
      }
      const searchDisplay = query || dim('[type to filter]');
      const selectedDisplay = selectedNames();
      const out = [
        `${label} (${items.length} available)`,
        selectedDisplay === '(none selected)'
          ? `Selected: ${dim('(none selected)')}`
          : `Selected: ${bold(selectedDisplay)}`,
        `Search: ${searchDisplay}`,
        dim('↑↓ navigate • Space toggle • Backspace remove • Enter confirm'),
      ];
      if (visible.length === 0) {
        out.push('  No matches');
      } else {
        for (let i = 0; i < visible.length; i += 1) {
          const isCursor = i === index;
          const cursorChar = isCursor ? '>' : ' ';
          const selectedSuffix = visible[i].selected ? dim(' (Selected)') : '';
          let line;
          if (isCursor) {
            const mark = visible[i].selected ? `${ANSI.green}●${ANSI.resetColor}` : '○';
            line = `${ANSI.bold}${cursorChar} ${mark} ${visible[i].name}${ANSI.reset}${selectedSuffix}`;
          } else {
            const mark = visible[i].selected ? `${ANSI.green}●${ANSI.resetColor}` : '○';
            line = `${cursorChar} ${mark} ${visible[i].name}${selectedSuffix}`;
          }
          out.push(line);
        }
      }
      out.push('(1/3)');
      process.stdout.write(out.join('\n') + '\n');
      linesCount = out.length;
    }

    function onData(buf) {
      if (!buf || buf.length === 0) return;
      const visible = filteredChoices();
      const key = parseKey(buf);

      if (key === 'cancel') {
        cleanup();
        removeListener();
        reject(new core.PingCodeError('Cancelled by user'));
        return;
      }
      if (key === 'confirm') {
        cleanup();
        removeListener();
        resolve(choices.filter((c) => c.selected).map((c) => c.id));
        return;
      }
      if (key === 'space') {
        if (visible[index]) {
          visible[index].selected = !visible[index].selected;
        }
      } else if (key === 'up') {
        index = (index - 1 + visible.length) % visible.length;
      } else if (key === 'down') {
        index = (index + 1) % visible.length;
      } else if (key === 'backspace') {
        query = query.slice(0, -1);
        index = 0;
      } else if (typeof key === 'string' && key.length === 1) {
        query += key;
        index = 0;
      }
      render();
    }

    process.stdout.write('\x1b[?25l'); // hide cursor
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
    render();
  });
}

function parseMcpArgs(tokens) {
  const { opts, remaining } = shared.parseGlobalOptions(tokens, ['--all', '--yes']);
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
    throw new core.PingCodeError(`Unknown option: ${arg}`);
  }

  opts.tool = tools;
  return { opts, helpRequested };
}

function isYes(value) {
  return /^(y|yes)$/i.test((value || '').trim());
}

async function selectTools(opts, inputFunc) {
  if (opts.all) {
    return TOOLS.slice();
  }
  if (opts.tool && opts.tool.length > 0) {
    const selected = [];
    for (const tool of TOOLS) {
      if (opts.tool.includes(tool.id)) {
        selected.push(tool);
      }
    }
    const unknown = opts.tool.find((id) => !TOOLS.some((t) => t.id === id));
    if (unknown) {
      throw new core.PingCodeError(`Unknown tool: ${unknown}`);
    }
    return selected;
  }

  const selectedIds = await checkboxSelect('Select AI clients to configure for PingCode MCP', TOOLS, inputFunc);
  return TOOLS.filter((tool) => selectedIds.includes(tool.id));
}

async function promptCredentials(opts, ask) {
  const env = {};

  if (opts.client_id) {
    env.PINGCODE_CLIENT_ID = opts.client_id;
  } else {
    const answer = await ask('PingCode Client ID (optional, press Enter to skip): ');
    const trimmed = (answer || '').trim();
    if (trimmed) {
      env.PINGCODE_CLIENT_ID = trimmed;
    }
  }

  if (opts.client_secret) {
    env.PINGCODE_CLIENT_SECRET = opts.client_secret;
  } else {
    const answer = await ask('PingCode Client Secret (optional, press Enter to skip): ');
    const trimmed = (answer || '').trim();
    if (trimmed) {
      env.PINGCODE_CLIENT_SECRET = trimmed;
    }
  }

  if (opts.base_url && opts.base_url !== core.DEFAULT_BASE_URL) {
    env.PINGCODE_BASE_URL = opts.base_url;
  }

  return env;
}

async function confirmSelection(selectedTools, ask, opts) {
  if (opts.yes) {
    return true;
  }
  const names = selectedTools.map((tool) => tool.name).join(', ');
  const answer = await ask(`The following clients will be configured: ${names}. Proceed? (y/N): `);
  return isYes(answer);
}

function printDryRun(selectedTools, env) {
  const result = {
    action: 'mcp init',
    package: PACKAGE_REF,
    tools: selectedTools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      file: tool.filePath(),
    })),
    environment: env,
  };
  core.printJson(result);
}

async function runInit(argv, inputFunc) {
  const parsed = parseMcpArgs(argv || []);
  if (parsed.helpRequested) {
    printInitHelp();
    return;
  }

  const selected = await selectTools(parsed.opts, inputFunc);
  if (selected.length === 0) {
    console.log('No AI clients selected. Nothing to do.');
    return;
  }

  const ask = createAsk(inputFunc);
  try {
    const env = await promptCredentials(parsed.opts, ask);
    const confirmed = await confirmSelection(selected, ask, parsed.opts);
    if (!confirmed) {
      console.log('Aborted.');
      return;
    }

    if (parsed.opts.dry_run) {
      printDryRun(selected, env);
      return;
    }

    for (const tool of selected) {
      const filePath = tool.filePath();
      tool.write(filePath, env);
      console.log(`Configured ${tool.name}: ${filePath}`);
    }
  } finally {
    closeAsk(ask);
  }
}

function printInitHelp() {
  console.log([
    'pingcode mcp init — Configure PingCode MCP in AI clients',
    '',
    'Usage: pingcode mcp init [options]',
    '',
    'Options:',
    '  --all                   Configure all supported clients',
    '  --tool <id>             Configure a specific client (can be repeated)',
    '  --client-id ID          PingCode OAuth client ID',
    '  --client-secret SECRET  PingCode OAuth client secret',
    '  --base-url URL          PingCode base URL',
    '  --dry-run               Show what would be written without writing',
    '  --yes                   Skip the final confirmation prompt',
    '  --help                  Show this help',
    '',
    'Supported clients: codex, opencode, omp',
    '',
    'Examples:',
    '  pingcode mcp init',
    '  pingcode mcp init --all',
    '  pingcode mcp init --tool codex --client-id ID --client-secret SECRET',
  ].join('\n'));
}

function printHelp() {
  console.log([
    'pingcode mcp — Manage PingCode MCP client configuration',
    '',
    'Usage: pingcode mcp <subcommand> [options]',
    '',
    'Subcommands:',
    '  init    Configure supported AI clients interactively',
    '',
    'Run `pingcode mcp init --help` for details.',
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
    case 'init':
      await runInit(remaining, inputFunc);
      break;
    default:
      throw new core.PingCodeError(`Unknown mcp subcommand: ${subcommand}`);
  }
}

module.exports = { run, runInit, printHelp, printInitHelp, parseMcpArgs, buildStdioEntry, buildCodexServerLines, checkboxSelect, confirmSelection, writeOmpConfig, writeOpenCodeConfig, writeCodexConfig, stripJsonComments };
