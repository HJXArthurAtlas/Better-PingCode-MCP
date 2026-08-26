'use strict';

const readline = require('node:readline');
const core = require('../core');
const shared = require('./shared');

async function promptChoice(label, items, inputFunc) {
  if (!items || items.length === 0) {
    throw new core.PingCodeError(`No ${label} options are available`);
  }
  console.log(`\nSelect current ${label}:`);
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const entity = core.normalizedEntity(item);
    const details = [];
    if (typeof entity.identifier === 'string' && entity.identifier) details.push(entity.identifier);
    if (typeof entity.name === 'string' && entity.name && entity.name !== core.displayName(item)) details.push(entity.name);
    if (typeof entity.email === 'string' && entity.email) details.push(entity.email);
    const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
    console.log(`  ${index + 1}. ${core.displayName(item)} [${core.itemId(item, label)}]${suffix}`);
  }

  while (true) {
    const raw = await inputFunc(`Enter ${label} number, id, or name: `);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^\d+$/.test(trimmed)) {
      const index = parseInt(trimmed, 10);
      if (index >= 1 && index <= items.length) return items[index - 1];
    }
    try {
      return core.findCachedItem(items, trimmed, label);
    } catch (exc) {
      console.log(`Invalid ${label} selection: ${exc.message}`);
    }
  }
}

async function fetchProjects(client, refresh = false) {
  if (refresh || !client.workspaceCache.projects) {
    return core.cacheProjects(client);
  }
  return client.workspaceCache.projects;
}

async function fetchSprints(client, projectId, refresh = false) {
  const cache = client.workspaceCache.sprints || {};
  if (refresh || !cache[projectId]) {
    return core.cacheSprints(client, projectId);
  }
  return cache[projectId];
}

async function fetchUsers(client, projectId, refresh = false) {
  const cache = client.workspaceCache.users;
  if (refresh || !cache || cache.project_id !== projectId) {
    return core.cacheUsers(client, projectId);
  }
  return cache;
}

async function tryCacheProjectDictionaries(client, projectId) {
  if (!projectId) return { cached: false, reason: 'no project id' };
  try {
    await core.cacheProjectDictionaries(client, projectId);
    return { cached: true };
  } catch (exc) {
    console.error(`warning: could not cache dictionaries: ${exc.message}`);
    return { cached: false, reason: exc.message };
  }
}

async function cacheContext(client, project, sprint, user, dictionaries) {
  const prefs = client.workspaceCache.preferences;
  prefs.current_project_id = core.itemId(project, 'project');
  prefs.current_project_name = core.displayName(project);
  prefs.current_sprint_id = core.itemId(sprint, 'sprint');
  prefs.current_sprint_name = core.displayName(sprint);
  prefs.current_user_id = core.itemId(user, 'user');
  prefs.current_user_name = core.displayName(user);
  client.saveWorkspaceCache();
  return {
    message: 'Workspace context cached',
    workspace_cache: client.workspaceCachePath,
    preferences: prefs,
    dictionaries_cached: Boolean(dictionaries && dictionaries.cached),
    ...(dictionaries && dictionaries.reason ? { dictionaries_error: dictionaries.reason } : {}),
  };
}

async function handleInit(opts, inputFunc) {
  const client = shared.clientFromOpts(opts);
  const rl = !inputFunc ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = inputFunc || ((prompt) => new Promise((resolve) => rl.question(prompt, resolve)));

  try {
    const project = await promptChoice('project', core.pageValues(await fetchProjects(client)), ask);
    const projectId = core.itemId(project, 'project');
    const sprint = await promptChoice('sprint', core.pageValues(await fetchSprints(client, projectId)), ask);
    const user = await promptChoice('user', core.pageValues(await fetchUsers(client, projectId)), ask);
    const dictionaries = await tryCacheProjectDictionaries(client, projectId);
    const result = await cacheContext(client, project, sprint, user, dictionaries);
    core.printJson(result);
  } finally {
    if (rl) rl.close();
  }
}

async function handleSetCurrentUser(value, opts) {
  if (!value) throw new core.PingCodeError('Usage: context set-current-user <id|name|@me>');
  const client = shared.clientFromOpts(opts);
  let userId = value;
  if (value === '@me') userId = core.currentUserId(null, client.workspaceCache);
  if (opts.dry_run) {
    core.printJson({ dry_run: true, action: 'set-current-user', input: value, resolved_user_id: userId });
    return;
  }
  const result = await core.setCurrentUser(client, userId);
  core.printJson(result);
}

async function handleSetCurrentProject(value, opts) {
  if (!value) throw new core.PingCodeError('Usage: context set-current-project <id|name>');
  const client = shared.clientFromOpts(opts);
  if (opts.dry_run) {
    let resolvedId = value;
    try {
      await fetchProjects(client);
      const found = core.findCachedItem(core.pageValues(client.workspaceCache.projects), value, 'project');
      if (found && found.id) resolvedId = found.id;
    } catch (_) {}
    core.printJson({ dry_run: true, action: 'set-current-project', input: value, resolved_project_id: resolvedId });
    return;
  }
  try {
    await fetchProjects(client);
  } catch (exc) {
    console.error(`warning: could not refresh project list: ${exc.message}`);
  }
  const result = await core.setCurrentProject(client, value);
  const dictionaries = await tryCacheProjectDictionaries(client, result.current_project_id);
  result.dictionaries_cached = Boolean(dictionaries.cached);
  if (dictionaries.reason) result.dictionaries_error = dictionaries.reason;
  core.printJson(result);
}

async function handleSetCurrentSprint(value, opts) {
  if (!value) throw new core.PingCodeError('Usage: context set-current-sprint <id|name>');
  const client = shared.clientFromOpts(opts);
  if (opts.dry_run) {
    let resolvedId = value;
    const allSprints = [];
    for (const payload of Object.values(client.workspaceCache.sprints || {})) {
      allSprints.push(...core.pageValues(payload));
    }
    try {
      const found = core.findCachedItem(allSprints, value, 'sprint');
      if (found && found.id) resolvedId = found.id;
    } catch (_) {}
    core.printJson({ dry_run: true, action: 'set-current-sprint', input: value, resolved_sprint_id: resolvedId });
    return;
  }
  const result = await core.setCurrentSprint(client, value);
  core.printJson(result);
}

async function handleList(opts) {
  const client = shared.clientFromOpts(opts);
  const cache = client.workspaceCache;
  const counts = {};
  counts.users = core.pageValues(cache.users).length;
  counts.projects = core.pageValues(cache.projects).length;
  counts.sprints = Object.values(cache.sprints || {}).reduce((sum, p) => sum + core.pageValues(p).length, 0);
  counts.work_item_types = Object.values(cache.work_item_types || {}).reduce((sum, p) => sum + core.pageValues(p).length, 0);
  counts.work_item_states = Object.values(cache.work_item_states || {}).reduce((sum, p) => sum + core.pageValues(p).length, 0);
  counts.work_item_priorities = Object.values(cache.work_item_priorities || {}).reduce((sum, p) => sum + core.pageValues(p).length, 0);
  counts.work_item_properties = Object.values(cache.work_item_properties || {}).reduce((sum, p) => sum + core.pageValues(p).length, 0);
  core.printJson({ preferences: cache.preferences, dictionaries: counts });
}

function parseContextArgs(tokens) {
  const { opts, remaining } = shared.parseGlobalOptions(tokens, ['--refresh']);
  let helpRequested = false;
  const positionals = [];
  for (const arg of remaining) {
    if (arg === '--help' || arg === '-h') {
      helpRequested = true;
    } else if (arg === '--refresh') {
      opts.refresh = true;
    } else {
      positionals.push(arg);
    }
  }
  return { subcommand: positionals[0] || null, value: positionals[1] || null, opts, helpRequested };
}

function printHelp() {
  console.log([
    'pingcode context — Manage workspace context',
    '',
    'Usage: pingcode context <subcommand> [options]',
    '',
    'Subcommands:',
    '  init                     Initialize workspace context (interactive)',
    '  set-current-user <id>    Set the current user',
    '  set-current-project <id>  Set the current project',
    '  set-current-sprint <id>   Set the current sprint',
    '  list                     Show current preferences and dictionary summary',
  ].join('\n'));
}

async function run(argv, inputFunc) {
  const tokens = argv || [];
  if (tokens.length === 0 || tokens[0] === '--help' || tokens[0] === '-h') {
    printHelp();
    return;
  }

  const parsed = parseContextArgs(tokens);
  if (parsed.helpRequested) {
    printHelp();
    return;
  }

  const subcommand = parsed.subcommand;
  if (!subcommand) {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'init':
      await handleInit(parsed.opts, inputFunc);
      break;
    case 'set-current-user':
      await handleSetCurrentUser(parsed.value, parsed.opts);
      break;
    case 'set-current-project':
      await handleSetCurrentProject(parsed.value, parsed.opts);
      break;
    case 'set-current-sprint':
      await handleSetCurrentSprint(parsed.value, parsed.opts);
      break;
    case 'list':
      await handleList(parsed.opts);
      break;
    default:
      throw new core.PingCodeError(`Unknown context subcommand: ${subcommand}`);
  }
}

shared.registerModule('context', {
  name: 'context',
  description: 'Manage workspace context',
  run,
});

module.exports = { run, printHelp, parseContextArgs };
