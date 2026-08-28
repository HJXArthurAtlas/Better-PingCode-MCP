'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const mcp = require('../src/commands/mcp');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'better-pingcode-mcp-'));
}

describe('buildStdioEntry', () => {
  it('creates stdio entry without env when env is empty', () => {
    const entry = mcp.buildStdioEntry({});
    assert.deepStrictEqual(entry, {
      command: 'npx',
      args: ['-y', '@arthuratlas/better-pingcode@latest', '--mcp'],
    });
  });

  it('embeds env vars when present', () => {
    const entry = mcp.buildStdioEntry({ PINGCODE_CLIENT_ID: 'id' });
    assert.strictEqual(entry.env.PINGCODE_CLIENT_ID, 'id');
    assert.strictEqual(entry.command, 'npx');
  });
});

describe('writeOmpConfig', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates a new OMP mcp.json', () => {
    const file = path.join(dir, 'mcp.json');
    mcp.writeOmpConfig(file, { PINGCODE_CLIENT_ID: 'id', PINGCODE_CLIENT_SECRET: 'secret' });
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(config.$schema);
    assert.strictEqual(config.mcpServers.pingcode.command, 'npx');
    assert.deepStrictEqual(config.mcpServers.pingcode.args, ['-y', '@arthuratlas/better-pingcode@latest', '--mcp']);
    assert.strictEqual(config.mcpServers.pingcode.env.PINGCODE_CLIENT_ID, 'id');
  });

  it('preserves other servers and the schema', () => {
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({
      $schema: 'https://example.com/schema.json',
      mcpServers: {
        other: { command: 'echo', args: [] },
      },
      disabledServers: ['other'],
    }, null, 2));
    mcp.writeOmpConfig(file, {});
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(config.$schema, 'https://example.com/schema.json');
    assert.deepStrictEqual(config.mcpServers.other, { command: 'echo', args: [] });
    assert.deepStrictEqual(config.disabledServers, ['other']);
    assert.ok(config.mcpServers.pingcode);
  });
});

describe('writeOpenCodeConfig', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates a new OpenCode config', () => {
    const file = path.join(dir, 'opencode.json');
    mcp.writeOpenCodeConfig(file, { PINGCODE_CLIENT_SECRET: 'secret' });
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(config.mcp.pingcode.type, 'local');
    assert.deepStrictEqual(config.mcp.pingcode.command, ['npx', '-y', '@arthuratlas/better-pingcode@latest', '--mcp']);
    assert.strictEqual(config.mcp.pingcode.environment.PINGCODE_CLIENT_SECRET, 'secret');
    assert.strictEqual(config.mcp.pingcode.enabled, true);
  });

  it('preserves unrelated top-level and mcp entries', () => {
    const file = path.join(dir, 'opencode.json');
    fs.writeFileSync(file, JSON.stringify({
      model: 'anthropic/claude-sonnet',
      mcp: {
        other: { type: 'local', command: ['node'], enabled: true },
      },
    }, null, 2));
    mcp.writeOpenCodeConfig(file, { PINGCODE_CLIENT_ID: 'id' });
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(config.model, 'anthropic/claude-sonnet');
    assert.ok(config.mcp.other);
    assert.strictEqual(config.mcp.pingcode.environment.PINGCODE_CLIENT_ID, 'id');
  });

  it('strips JSONC comments before merging', () => {
    const file = path.join(dir, 'opencode.jsonc');
    fs.writeFileSync(file, `{
      // model
      "model": "x",
      /* mcp block */
      "mcp": {}
    }`);
    mcp.writeOpenCodeConfig(file, {});
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(config.model, 'x');
    assert.ok(config.mcp.pingcode);
  });
});

describe('writeCodexConfig', () => {
  let dir;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates a new Codex config.toml', () => {
    const file = path.join(dir, 'config.toml');
    mcp.writeCodexConfig(file, { PINGCODE_CLIENT_ID: 'id' });
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.includes('[mcp_servers.pingcode]'));
    assert.ok(raw.includes('command = "npx"'));
    assert.ok(raw.includes('[mcp_servers.pingcode.env]'));
    assert.ok(raw.includes('PINGCODE_CLIENT_ID = "id"'));
  });

  it('replaces an existing pingcode section and preserves others', () => {
    const file = path.join(dir, 'config.toml');
    fs.writeFileSync(file, [
      '[mcp_servers.other]',
      'command = "echo"',
      '',
      '[mcp_servers.pingcode]',
      'command = "old"',
      'args = ["old"]',
      '',
      '[mcp_servers.pingcode.env]',
      'PINGCODE_CLIENT_ID = "old"',
      '',
      '[mcp_servers.another]',
      'command = "echo"',
    ].join('\n'));
    mcp.writeCodexConfig(file, { PINGCODE_CLIENT_ID: 'new' });
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    assert.ok(lines.some((line) => line === '[mcp_servers.pingcode]'));
    assert.ok(raw.includes('PINGCODE_CLIENT_ID = "new"'));
    assert.ok(!raw.includes('command = "old"'));
    assert.ok(raw.includes('[mcp_servers.other]'));
    assert.ok(raw.includes('[mcp_servers.another]'));
  });

  it('appends when no pingcode section exists', () => {
    const file = path.join(dir, 'config.toml');
    fs.writeFileSync(file, '[mcp_servers.other]\ncommand = "echo"\n');
    mcp.writeCodexConfig(file, {});
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(raw.includes('[mcp_servers.other]'));
    assert.ok(raw.includes('[mcp_servers.pingcode]'));
  });
});

describe('runInit', () => {
  let dir;
  let originalHomedir;
  beforeEach(() => {
    dir = tmpDir();
    originalHomedir = os.homedir;
    os.homedir = () => dir;
  });
  afterEach(() => {
    os.homedir = originalHomedir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('configures a specific tool with flags', async () => {
    await mcp.runInit(['--tool', 'omp', '--client-id', 'cid', '--client-secret', 'sec', '--yes']);
    const config = JSON.parse(fs.readFileSync(path.join(dir, '.omp', 'agent', 'mcp.json'), 'utf8'));
    assert.strictEqual(config.mcpServers.pingcode.env.PINGCODE_CLIENT_ID, 'cid');
  });

  it('configures multiple selected tools interactively', async () => {
    const fakeInput = (prompt) => {
      if (prompt && typeof prompt === 'object' && prompt.type === 'checkbox') {
        return ['codex', 'omp'];
      }
      if (typeof prompt === 'string' && prompt.includes('Proceed?')) {
        return 'y';
      }
      return '';
    };
    await mcp.runInit([], fakeInput);
    assert.ok(fs.existsSync(path.join(dir, '.codex', 'config.toml')));
    assert.ok(!fs.existsSync(path.join(dir, '.config', 'opencode', 'opencode.json')));
    assert.ok(fs.existsSync(path.join(dir, '.omp', 'agent', 'mcp.json')));
  });

  it('prints dry-run plan without writing', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await mcp.runInit(['--all', '--dry-run', '--yes', '--client-id', 'x', '--client-secret', 'y']);
    } finally {
      console.log = originalLog;
    }
    assert.ok(!fs.existsSync(path.join(dir, '.omp')));
    const output = logs.join('\n');
    assert.ok(output.includes('"action": "mcp init"'));
    assert.ok(output.includes('"id": "codex"'));
  });
});

describe('parseMcpArgs', () => {
  it('parses --tool repeated and --all', () => {
    const parsed = mcp.parseMcpArgs(['--all', '--tool', 'codex', '--client-id', 'id']);
    assert.strictEqual(parsed.opts.all, true);
    assert.deepStrictEqual(parsed.opts.tool, ['codex']);
    assert.strictEqual(parsed.opts.client_id, 'id');
  });

  it('parses --yes', () => {
    const parsed = mcp.parseMcpArgs(['--yes']);
    assert.strictEqual(parsed.opts.yes, true);
  });

  it('rejects unknown options', () => {
    assert.throws(() => mcp.parseMcpArgs(['--unknown']), /Unknown option/);
  });
});

describe('checkboxSelect', () => {
  it('returns selected ids from a function input', async () => {
    const result = await mcp.checkboxSelect('label', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ], (ctx) => ['b']);
    assert.deepStrictEqual(result, ['b']);
  });

  it('falls back to y/n when not a TTY and inputFunc is an array', async () => {
    const result = await mcp.checkboxSelect('label', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ], ['y', 'n']);
    assert.deepStrictEqual(result, ['a']);
  });
});

describe('confirmSelection', () => {
  it('returns true when --yes is set', async () => {
    const result = await mcp.confirmSelection([{ name: 'x' }], null, { yes: true });
    assert.strictEqual(result, true);
  });

  it('returns true on yes answer', async () => {
    const result = await mcp.confirmSelection([{ name: 'x' }], () => 'y', {});
    assert.strictEqual(result, true);
  });

  it('returns false on no answer', async () => {
    const result = await mcp.confirmSelection([{ name: 'x' }], () => 'n', {});
    assert.strictEqual(result, false);
  });
});

describe('checkboxSelect TTY mode', () => {
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;
  let fakeStdin;
  let writes;

  beforeEach(() => {
    writes = [];
    fakeStdin = new EventEmitter();
    fakeStdin.isTTY = true;
    fakeStdin.setRawMode = () => {};
    fakeStdin.resume = () => {};
    fakeStdin.pause = () => {};
    const fakeStdout = {
      write: (chunk) => {
        writes.push(String(chunk));
        return true;
      },
    };
    Object.defineProperty(process, 'stdin', { get: () => fakeStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { get: () => fakeStdout, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { get: () => originalStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { get: () => originalStdout, configurable: true });
  });

  function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  it('clears residual text when unselecting', async () => {
    const promise = mcp.checkboxSelect('Select tools', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    fakeStdin.emit('data', Buffer.from(' ')); // select A
    fakeStdin.emit('data', Buffer.from(' ')); // unselect A
    fakeStdin.emit('data', Buffer.from('\r')); // confirm
    const result = await promise;
    assert.deepStrictEqual(result, []);
    const all = stripAnsi(writes.join(''));
    assert.ok(all.includes('Selected: (none selected)'));
    assert.ok(!all.includes('Selected: (none selected)A'));
  });
});
