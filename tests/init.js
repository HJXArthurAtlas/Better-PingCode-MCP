'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const init = require('../src/commands/init');
const auth = require('../src/commands/auth');
const core = require('../src/core');

describe('parseInitArgs', () => {
  it('parses all init options', () => {
    const parsed = init.parseInitArgs([
      '--all', '--yes', '--dry-run', '--browser',
      '--client-id', 'id', '--client-secret', 'secret',
      '--tool', 'codex', '--tool', 'omp',
      '--redirect-uri', 'http://localhost/cb',
      '--port', '1234',
    ]);
    assert.strictEqual(parsed.opts.all, true);
    assert.strictEqual(parsed.opts.yes, true);
    assert.strictEqual(parsed.opts.dry_run, true);
    assert.strictEqual(parsed.opts.browser, true);
    assert.strictEqual(parsed.opts.client_id, 'id');
    assert.strictEqual(parsed.opts.client_secret, 'secret');
    assert.deepStrictEqual(parsed.opts.tool, ['codex', 'omp']);
    assert.strictEqual(parsed.opts.redirect_uri, 'http://localhost/cb');
    assert.strictEqual(parsed.opts.port, 1234);
  });

  it('defaults redirect-uri and port', () => {
    const parsed = init.parseInitArgs([]);
    assert.strictEqual(parsed.opts.redirect_uri, 'http://127.0.0.1:8765/callback');
    assert.strictEqual(parsed.opts.port, 8765);
  });

  it('rejects unknown options', () => {
    assert.throws(() => init.parseInitArgs(['--unknown']), /Unknown option/);
  });
});

describe('init run', () => {
  let dir;
  let originalHomedir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'better-pingcode-init-'));
    originalHomedir = os.homedir;
    os.homedir = () => dir;
    const tokenCacheDest = path.join(dir, '.cache', 'bpingcode', 'token.json');
    fs.mkdirSync(path.dirname(tokenCacheDest), { recursive: true });
    core.saveCachedToken(tokenCacheDest, 'test-token', 3600, 'client_credentials');
  });

  afterEach(() => {
    os.homedir = originalHomedir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dry-run does not write files', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      await init.run(['--all', '--yes', '--dry-run', '--client-id', 'id', '--client-secret', 'sec'], []);
    } finally {
      console.log = originalLog;
    }
    assert.ok(!fs.existsSync(path.join(dir, '.omp')));
    const output = logs.join('\n');
    assert.ok(output.includes('"action": "mcp init"'));
  });

  it('writes all client configs non-interactively', async () => {
    await init.run(['--all', '--yes', '--client-id', 'id', '--client-secret', 'sec'], []);
    assert.ok(fs.existsSync(path.join(dir, '.codex', 'config.toml')));
    assert.ok(fs.existsSync(path.join(dir, '.config', 'opencode', 'opencode.json')));
    assert.ok(fs.existsSync(path.join(dir, '.omp', 'agent', 'mcp.json')));
  });
});

describe('auth module no longer exposes login', () => {
  it('throws on login subcommand', async () => {
    await assert.rejects(auth.run(['login']), /Unknown auth subcommand: login/);
  });

  it('status help no longer mentions login', () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      auth.printHelp();
    } finally {
      console.log = originalLog;
    }
    const output = logs.join('\n');
    assert.ok(!output.includes('login'));
    assert.ok(output.includes('status'));
  });
});
