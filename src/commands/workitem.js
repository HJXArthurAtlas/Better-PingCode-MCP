'use strict';

const core = require('../core');
const shared = require('./shared');

const EXTRA_BOOLEAN_FLAGS = ['--all-users', '--all-projects', '--all-sprints'];
const ALL_BOOLEAN_FLAGS = new Set([...shared.BASE_GLOBAL_BOOLEAN_FLAGS, ...EXTRA_BOOLEAN_FLAGS]);

function findAllCachedStates(cache) {
  const states = [];
  for (const payload of Object.values(cache.work_item_states || {})) {
    states.push(...core.pageValues(payload));
  }
  return states;
}

function findCachedWorkItemType(cache, query) {
  const types = [];
  for (const payload of Object.values(cache.work_item_types || {})) {
    types.push(...core.pageValues(payload));
  }
  return core.findCachedItem(types, query, 'type');
}

function findCachedPriority(cache, query) {
  const priorities = [];
  for (const payload of Object.values(cache.work_item_priorities || {})) {
    priorities.push(...core.pageValues(payload));
  }
  return core.findCachedItem(priorities, query, 'priority');
}

function findCachedUser(cache, query) {
  return core.findCachedItem(core.pageValues(cache.users), query, 'user');
}

function findCachedProject(cache, query) {
  return core.findCachedItem(core.pageValues(cache.projects), query, 'project');
}

function findCachedSprint(cache, query) {
  const allSprints = [];
  for (const payload of Object.values(cache.sprints || {})) {
    allSprints.push(...core.pageValues(payload));
  }
  return core.findCachedItem(allSprints, query, 'sprint');
}

function resolveId(value, resolver, cache, label) {
  if (!value) return null;
  if (/^[a-fA-F0-9]{24,32}$/.test(value)) return value;
  const found = resolver(cache, value);
  return found ? found.id : value;
}

function isIdentifier(arg) {
  return /^[A-Z]{3,6}-\d+$/.test(arg);
}

function parseListArgs(tokens) {
  const args = { state: null, type: null, assignee: null, project: null, sprint: null, limit: null, keywords: null };
  const stringFlags = {
    '--state': 'state',
    '--type': 'type',
    '--assignee': 'assignee',
    '--project': 'project',
    '--sprint': 'sprint',
    '--limit': 'limit',
    '--keywords': 'keywords',
  };
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg in stringFlags) {
      if (i + 1 >= tokens.length) throw new core.PingCodeError(`Flag ${arg} requires a value`);
      args[stringFlags[arg]] = tokens[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flag = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (flag in stringFlags) {
          args[stringFlags[flag]] = value;
        } else {
          throw new core.PingCodeError(`Unknown option: ${flag}`);
        }
      } else if (!ALL_BOOLEAN_FLAGS.has(arg)) {
        throw new core.PingCodeError(`Unknown option: ${arg}`);
      }
    } else {
      throw new core.PingCodeError(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

async function runList(client, opts, args) {
  const params = {};
  const cache = client.workspaceCache;
  const defaultToCurrentUser = !opts.all_users && client.resolveGrantType() !== 'authorization_code';

  const filtered = core.applyDefaultWorkItemFilters(
    '/v1/project/work_items',
    params,
    client,
    opts.user_id,
    opts.user_name,
    defaultToCurrentUser,
    opts.all_projects,
    opts.all_sprints,
  );

  if (args.state) filtered.state_id = resolveId(args.state, findAllCachedStates, cache, 'state').id;
  if (args.type) filtered.type_ids = findCachedWorkItemType(cache, args.type).id;
  if (args.assignee) filtered.assignee_ids = findCachedUser(cache, args.assignee).id;
  if (args.project) filtered.project_ids = findCachedProject(cache, args.project).id;
  if (args.sprint) filtered.sprint_ids = findCachedSprint(cache, args.sprint).id;
  if (args.limit) filtered.page_size = String(args.limit);
  if (args.keywords) filtered.keywords = args.keywords;

  return client.request('GET', '/v1/project/work_items', filtered, null, { dry_run: opts.dry_run, use_workspace_cache: true });
}

function parseCreateArgs(tokens) {
  const args = {
    title: null, type: null, project: null, sprint: null, assignee: null,
    state: null, priority: null, description: null, parent: null,
  };
  const stringFlags = {
    '--title': 'title', '--type': 'type', '--project': 'project', '--sprint': 'sprint',
    '--assignee': 'assignee', '--state': 'state', '--priority': 'priority',
    '--description': 'description', '--parent': 'parent',
  };
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (arg in stringFlags) {
      if (i + 1 >= tokens.length) throw new core.PingCodeError(`Flag ${arg} requires a value`);
      args[stringFlags[arg]] = tokens[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flag = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (flag in stringFlags) args[stringFlags[flag]] = value;
        else if (!ALL_BOOLEAN_FLAGS.has(flag)) throw new core.PingCodeError(`Unknown option: ${flag}`);
      } else if (!ALL_BOOLEAN_FLAGS.has(arg)) {
        throw new core.PingCodeError(`Unknown option: ${arg}`);
      }
    } else {
      throw new core.PingCodeError(`Unexpected argument: ${arg}`);
    }
  }
  return args;
}

async function runCreate(client, opts, args) {
  if (!args.title || !args.title.trim()) throw new core.PingCodeError('--title is required');
  core.ensureWorkItemWorkspaceContext('/v1/project/work_items', client, 'POST', !opts.all_users, opts.all_projects, opts.all_sprints);
  const cache = client.workspaceCache;
  const body = { title: args.title };

  if (args.project) {
    body.project_id = findCachedProject(cache, args.project).id;
  } else {
    const pid = cache.preferences.current_project_id;
    if (pid) body.project_id = pid;
  }

  if (args.type) body.type_id = findCachedWorkItemType(cache, args.type).id;
  if (args.sprint) body.sprint_id = findCachedSprint(cache, args.sprint).id;
  if (args.state) body.state_id = core.findCachedItem(findAllCachedStates(cache), args.state, 'state').id;
  if (args.priority) body.priority_id = findCachedPriority(cache, args.priority).id;
  if (args.description) body.description = args.description;
  if (args.parent) body.parent_id = args.parent;
  if (args.assignee) body.assignee_id = findCachedUser(cache, args.assignee).id;

  const withDefaults = core.applyDefaultWorkItemCreateBody(
    'POST',
    '/v1/project/work_items',
    body,
    client,
    opts.user_id,
    !opts.all_users && !args.assignee,
  );

  return client.request('POST', '/v1/project/work_items', null, withDefaults, { dry_run: opts.dry_run, use_workspace_cache: true });
}

function parseGetArgs(tokens) {
  let workItemId = null;
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (!arg.startsWith('--')) {
      if (workItemId === null) { workItemId = arg; continue; }
      throw new core.PingCodeError(`Unexpected argument: ${arg}`);
    }
    if (ALL_BOOLEAN_FLAGS.has(arg)) continue;
    if (shared.BASE_GLOBAL_STRING_FLAGS[arg]) i += 1;
  }
  if (!workItemId) throw new core.PingCodeError('A work item id or identifier is required');
  return { work_item_id: workItemId };
}

async function runGet(client, opts, args) {
  if (isIdentifier(args.work_item_id)) {
    const resolved = await client.request('GET', '/v1/project/work_items', { identifier: args.work_item_id }, null, { dry_run: false, use_workspace_cache: true });
    const values = core.pageValues(resolved);
    if (values.length === 0) throw new core.PingCodeError(`No work item found with identifier ${args.work_item_id}`);
    const workItemId = values[0].id;
    return client.request('GET', `/v1/project/work_items/${workItemId}`, null, null, { dry_run: opts.dry_run, use_workspace_cache: true });
  }
  return client.request('GET', `/v1/project/work_items/${args.work_item_id}`, null, null, { dry_run: opts.dry_run, use_workspace_cache: true });
}

function parseUpdateArgs(tokens) {
  const args = {
    target: null, title: null, description: null, type: null, project: null, sprint: null,
    state: null, priority: null, assignee: null, parent: null, version: null, board: null,
    entry: null, swimlane: null, startAt: null, endAt: null, participants: null,
    storyPoints: null, estimatedWorkload: null, remainingWorkload: null, properties: null,
  };
  const stringFlags = {
    '--title': 'title', '--description': 'description', '--type': 'type', '--project': 'project',
    '--sprint': 'sprint', '--state': 'state', '--priority': 'priority', '--assignee': 'assignee',
    '--parent': 'parent', '--version': 'version', '--board': 'board', '--entry': 'entry',
    '--swimlane': 'swimlane', '--start-at': 'startAt', '--end-at': 'endAt',
    '--participants': 'participants', '--story-points': 'storyPoints',
    '--estimated-workload': 'estimatedWorkload', '--remaining-workload': 'remainingWorkload',
    '--properties': 'properties',
  };
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    if (!arg.startsWith('--')) {
      if (args.target === null) { args.target = arg; continue; }
      throw new core.PingCodeError(`Unexpected argument: ${arg}`);
    }
    if (arg in stringFlags) {
      if (i + 1 >= tokens.length) throw new core.PingCodeError(`Flag ${arg} requires a value`);
      args[stringFlags[arg]] = tokens[i + 1];
      i += 1;
    } else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        const flag = arg.slice(0, eqIndex);
        const value = arg.slice(eqIndex + 1);
        if (flag in stringFlags) args[stringFlags[flag]] = value;
        else if (!ALL_BOOLEAN_FLAGS.has(flag) && !(flag in shared.BASE_GLOBAL_STRING_FLAGS)) throw new core.PingCodeError(`Unknown option: ${flag}`);
      } else if (!ALL_BOOLEAN_FLAGS.has(arg)) {
        throw new core.PingCodeError(`Unknown option: ${arg}`);
      }
    }
  }
  if (!args.target) throw new core.PingCodeError('A work item id or identifier is required');
  const hasUpdate = Object.entries(args).some(([k, v]) => k !== 'target' && v !== null);
  if (!hasUpdate) throw new core.PingCodeError('At least one field to update is required');
  return args;
}

function parseNumber(value, label) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) throw new core.PingCodeError(`${label} must be a number`);
  return parsed;
}

function parseTimestamp(value, label) {
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new core.PingCodeError(`${label} must be a Unix timestamp or ISO date string`);
  return Math.floor(date.getTime() / 1000);
}

function resolveParticipants(value, cache) {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.map((item) => {
    if (item.startsWith('@user:')) return core.cachedUserId(item.slice(6), cache);
    return findCachedUser(cache, item).id;
  });
}

async function runUpdate(client, opts, args) {
  const cache = client.workspaceCache;
  const body = {};

  if (args.title) body.title = args.title;
  if (args.description) body.description = args.description;
  if (args.project) body.project_id = findCachedProject(cache, args.project).id;
  if (args.type) body.type_id = findCachedWorkItemType(cache, args.type).id;
  if (args.sprint) body.sprint_id = findCachedSprint(cache, args.sprint).id;
  if (args.state) body.state_id = core.findCachedItem(findAllCachedStates(cache), args.state, 'state').id;
  if (args.priority) body.priority_id = findCachedPriority(cache, args.priority).id;
  if (args.assignee) body.assignee_id = findCachedUser(cache, args.assignee).id;
  if (args.parent) body.parent_id = args.parent;
  if (args.version) body.version_id = args.version;
  if (args.board) body.board_id = args.board;
  if (args.entry) body.entry_id = args.entry;
  if (args.swimlane) body.swimlane_id = args.swimlane;
  if (args.startAt) body.start_at = parseTimestamp(args.startAt, 'start_at');
  if (args.endAt) body.end_at = parseTimestamp(args.endAt, 'end_at');
  if (args.participants) body.participant_ids = resolveParticipants(args.participants, cache);
  if (args.storyPoints) body.story_points = parseNumber(args.storyPoints, 'story_points');
  if (args.estimatedWorkload) body.estimated_workload = parseNumber(args.estimatedWorkload, 'estimated_workload');
  if (args.remainingWorkload) body.remaining_workload = parseNumber(args.remainingWorkload, 'remaining_workload');
  if (args.properties) body.properties = core.parseJsonObject(args.properties, 'properties');

  const sortedBody = {};
  for (const k of Object.keys(body).sort()) sortedBody[k] = body[k];

  if (isIdentifier(args.target)) {
    const resolved = await client.request('GET', '/v1/project/work_items', { identifier: args.target }, null, { dry_run: false, use_workspace_cache: true });
    const values = core.pageValues(resolved);
    if (values.length === 0) throw new core.PingCodeError(`No work item found with identifier ${args.target}`);
    const workItemId = values[0].id;
    return client.request('PATCH', `/v1/project/work_items/${workItemId}`, null, sortedBody, { dry_run: opts.dry_run, use_workspace_cache: false });
  }

  return client.request('PATCH', `/v1/project/work_items/${args.target}`, null, sortedBody, { dry_run: opts.dry_run, use_workspace_cache: false });
}

function printHelp() {
  console.log([
    'pingcode workitem — Manage work items',
    '',
    'Usage: pingcode workitem <subcommand> [options]',
    '',
    'Subcommands:',
    '  list    List work items',
    '  create  Create a work item',
    '  get     Get a single work item',
    '  update  Update a work item',
  ].join('\n'));
}

function printSubcommandHelp(subcommand) {
  switch (subcommand) {
    case 'list':
      console.log([
        'Usage: pingcode workitem list [options]',
        '',
        'Options:',
        '  --state NAME       State name',
        '  --type NAME        Work item type name',
        '  --assignee NAME    Assignee name or @me',
        '  --project NAME     Project name',
        '  --sprint NAME      Sprint name',
        '  --keywords TEXT    Search keywords',
        '  --limit N          Page size',
        '  --all-users        Do not filter by current user',
        '  --all-projects     Do not filter by current project',
        '  --all-sprints      Do not filter by current sprint',
      ].join('\n'));
      break;
    case 'create':
      console.log([
        'Usage: pingcode workitem create --title TEXT [options]',
        '',
        'Options:',
        '  --type NAME        Work item type name',
        '  --project NAME     Project name',
        '  --sprint NAME      Sprint name',
        '  --assignee NAME    Assignee name or @me',
        '  --state NAME       State name',
        '  --priority NAME    Priority name',
        '  --description TEXT Description',
        '  --parent ID        Parent work item id',
      ].join('\n'));
      break;
    case 'get':
      console.log('Usage: pingcode workitem get <id|identifier>');
      break;
    case 'update':
      console.log([
        'Usage: pingcode workitem update <id|identifier> [options]',
        '',
        'Options:',
        '  --title TEXT, --description TEXT, --type NAME, --project NAME,',
        '  --sprint NAME, --state NAME, --priority NAME, --assignee NAME,',
        '  --parent ID, --version ID, --board ID, --entry ID, --swimlane ID,',
        '  --start-at TS, --end-at TS, --participants ID,ID,',
        '  --story-points N, --estimated-workload N, --remaining-workload N,',
        '  --properties JSON',
      ].join('\n'));
      break;
    default:
      printHelp();
  }
}

async function run(argv) {
  const tokens = argv || [];
  if (tokens.length === 0 || tokens[0] === '--help' || tokens[0] === '-h') {
    printHelp();
    return;
  }

  const subcommand = tokens[0];
  const remaining = tokens.slice(1);

  if (remaining.includes('--help') || remaining.includes('-h')) {
    printSubcommandHelp(subcommand);
    return;
  }

  const { opts, remaining: subArgs } = shared.parseGlobalOptions(remaining, EXTRA_BOOLEAN_FLAGS);
  const client = shared.clientFromOpts(opts);
  let result;

  switch (subcommand) {
    case 'list': {
      const listArgs = parseListArgs(subArgs);
      result = await runList(client, opts, listArgs);
      break;
    }
    case 'create': {
      const createArgs = parseCreateArgs(subArgs);
      result = await runCreate(client, opts, createArgs);
      break;
    }
    case 'get': {
      const getArgs = parseGetArgs(subArgs);
      result = await runGet(client, opts, getArgs);
      break;
    }
    case 'update': {
      const updateArgs = parseUpdateArgs(subArgs);
      result = await runUpdate(client, opts, updateArgs);
      break;
    }
    default:
      throw new core.PingCodeError(`Unknown workitem subcommand: ${subcommand}`);
  }

  if (opts.dry_run) {
    core.printJson(result);
  } else if (result !== null && result !== undefined) {
    core.printJson(opts.compact ? core.compactResponse(result) : result);
  }
}

shared.registerModule('workitem', {
  name: 'workitem',
  description: 'Manage work items',
  run,
});

module.exports = { run, printHelp, parseListArgs, parseCreateArgs, parseGetArgs, parseUpdateArgs };
