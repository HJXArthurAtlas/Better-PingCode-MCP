'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const core = require('./core');
const authCmd = require('./commands/auth');
const workitemCmd = require('./commands/workitem');
const pkg = require('../package.json');

function buildClient(args) {
  const clientId = args.client_id || process.env.PINGCODE_CLIENT_ID || null;
  const clientSecret = args.client_secret || process.env.PINGCODE_CLIENT_SECRET || null;
  if (!clientId || !clientSecret) {
    throw new core.PingCodeError(
      'Missing PINGCODE_CLIENT_ID / PINGCODE_CLIENT_SECRET. Configure them in the MCP server environment.'
    );
  }
  return new core.PingCodeClient({
    base_url: args.base_url || process.env.PINGCODE_BASE_URL,
    client_id: clientId,
    client_secret: clientSecret,
    token: args.token || process.env.PINGCODE_TOKEN || null,
    token_cache: core.DEFAULT_TOKEN_CACHE,
    workspace_cache: args.workspace_cache || core.DEFAULT_WORKSPACE_CACHE,
    grant_type: args.grant_type || 'auto',
  });
}

async function captureConsoleAsync(fn) {
  const original = console.log;
  const output = [];
  console.log = (...args) => output.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return output.join('\n');
}

function textResponse(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function jsonResponse(data) {
  return textResponse(JSON.stringify(data, null, 2));
}

const TOOLS = [
  {
    name: 'pingcode_auth_status',
    description: 'Check PingCode authentication status, token cache, and workspace cache.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', description: 'PingCode base URL' },
        client_id: { type: 'string', description: 'OAuth client ID' },
        client_secret: { type: 'string', description: 'OAuth client secret' },
        grant_type: { type: 'string', description: 'OAuth grant type' },
      },
    },
  },
  {
    name: 'pingcode_auth_get_authorization_url',
    description: 'Get the OAuth2 authorization URL for user-token login. Open this URL in a browser and paste the code into pingcode_auth_exchange_code.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', description: 'PingCode base URL' },
        client_id: { type: 'string', description: 'OAuth client ID' },
        client_secret: { type: 'string', description: 'OAuth client secret' },
        redirect_uri: { type: 'string', description: 'OAuth redirect URI' },
      },
    },
  },
  {
    name: 'pingcode_auth_exchange_code',
    description: 'Exchange an OAuth2 authorization code for a user token.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Authorization code from PingCode' },
        base_url: { type: 'string', description: 'PingCode base URL' },
        client_id: { type: 'string', description: 'OAuth client ID' },
        client_secret: { type: 'string', description: 'OAuth client secret' },
        redirect_uri: { type: 'string', description: 'OAuth redirect URI' },
      },
      required: ['code'],
    },
  },
  {
    name: 'pingcode_list_projects',
    description: 'List PingCode projects available to the current credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'pingcode_list_sprints',
    description: 'List sprints/iterations for a PingCode project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project raw id' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'pingcode_list_users',
    description: 'List PingCode users (project members).',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project raw id' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'pingcode_context_set',
    description: 'Set the current workspace context (project, sprint, user). Pass at least one of project_id, sprint_id, user_id.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project raw id' },
        sprint_id: { type: 'string', description: 'Sprint raw id' },
        user_id: { type: 'string', description: 'User raw id' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'pingcode_context_get',
    description: 'Get the current workspace context preferences and cached dictionary counts.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'pingcode_workitem_list',
    description: 'List PingCode work items. Defaults to current user/project/sprint from workspace context.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'State name' },
        type: { type: 'string', description: 'Work item type name' },
        assignee: { type: 'string', description: 'Assignee name or @me' },
        project: { type: 'string', description: 'Project name' },
        sprint: { type: 'string', description: 'Sprint name' },
        keywords: { type: 'string', description: 'Search keywords' },
        limit: { type: 'integer', description: 'Page size' },
        all_users: { type: 'boolean', description: 'Do not filter by current user' },
        all_projects: { type: 'boolean', description: 'Do not filter by current project' },
        all_sprints: { type: 'boolean', description: 'Do not filter by current sprint' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        user_id: { type: 'string' },
        user_name: { type: 'string' },
        grant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'pingcode_workitem_get',
    description: 'Get a single PingCode work item by raw id or identifier (e.g., SCR-123).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Work item id or identifier' },
        identifier: { type: 'string', description: 'Work item identifier such as SCR-123' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        grant_type: { type: 'string' },
      },
    },
  },
  {
    name: 'pingcode_workitem_create',
    description: 'Create a PingCode work item.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Work item title' },
        type: { type: 'string', description: 'Work item type name' },
        project: { type: 'string', description: 'Project name' },
        sprint: { type: 'string', description: 'Sprint name' },
        assignee: { type: 'string', description: 'Assignee name or @me' },
        state: { type: 'string', description: 'State name' },
        priority: { type: 'string', description: 'Priority name' },
        description: { type: 'string' },
        parent: { type: 'string', description: 'Parent work item id' },
        all_users: { type: 'boolean' },
        all_projects: { type: 'boolean' },
        all_sprints: { type: 'boolean' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        user_id: { type: 'string' },
        user_name: { type: 'string' },
        grant_type: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'pingcode_workitem_update',
    description: 'Update a PingCode work item by raw id or identifier (e.g., SCR-123).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Work item id or identifier' },
        title: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string', description: 'Work item type name' },
        project: { type: 'string', description: 'Project name' },
        sprint: { type: 'string', description: 'Sprint name' },
        state: { type: 'string', description: 'State name' },
        priority: { type: 'string', description: 'Priority name' },
        assignee: { type: 'string', description: 'Assignee name or @me' },
        parent: { type: 'string' },
        version: { type: 'string' },
        board: { type: 'string' },
        entry: { type: 'string' },
        swimlane: { type: 'string' },
        start_at: { type: 'integer', description: 'Unix timestamp or ISO date' },
        end_at: { type: 'integer', description: 'Unix timestamp or ISO date' },
        participants: { type: 'string', description: 'Comma-separated user names' },
        story_points: { type: 'number' },
        estimated_workload: { type: 'number' },
        remaining_workload: { type: 'number' },
        properties: { type: 'string', description: 'JSON object string' },
        base_url: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
        user_id: { type: 'string' },
        user_name: { type: 'string' },
        grant_type: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case 'pingcode_auth_status': {
      const output = await captureConsoleAsync(async () => {
        await authCmd.runStatus(['--compact', `--base_url=${args.base_url || process.env.PINGCODE_BASE_URL || core.DEFAULT_BASE_URL}`, `--client_id=${args.client_id || process.env.PINGCODE_CLIENT_ID || ''}`, `--client_secret=${args.client_secret || process.env.PINGCODE_CLIENT_SECRET || ''}`, `--grant_type=${args.grant_type || 'auto'}`]);
      });
      return textResponse(output || '{}');
    }

    case 'pingcode_auth_get_authorization_url': {
      const client = buildClient(args);
      const redirectUri = args.redirect_uri || 'http://127.0.0.1:8765/callback';
      const state = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      const url = client.buildAuthorizationUrl(redirectUri, state);
      return jsonResponse({ authorization_url: url, redirect_uri: redirectUri, state });
    }

    case 'pingcode_auth_exchange_code': {
      const client = buildClient(args);
      const redirectUri = args.redirect_uri || 'http://127.0.0.1:8765/callback';
      const result = await client.exchangeAuthorizationCode(args.code, redirectUri);
      return jsonResponse({ access_token_stored: true, grant_type: 'authorization_code', refresh_token_present: !!result.refresh_token });
    }

    case 'pingcode_list_projects': {
      const client = buildClient(args);
      const projects = await core.cacheProjects(client);
      return jsonResponse(core.compactResponse(projects));
    }

    case 'pingcode_list_sprints': {
      const client = buildClient(args);
      const sprints = await core.cacheSprints(client, args.project_id);
      return jsonResponse(core.compactResponse(sprints));
    }

    case 'pingcode_list_users': {
      const client = buildClient(args);
      const users = await core.cacheUsers(client, args.project_id);
      return jsonResponse(core.compactResponse(users));
    }

    case 'pingcode_context_set': {
      const client = buildClient(args);
      const results = {};
      if (args.project_id) {
        await core.setCurrentProject(client, args.project_id);
        await core.cacheProjectDictionaries(client, args.project_id);
        results.project_set = args.project_id;
      }
      if (args.sprint_id) {
        await core.setCurrentSprint(client, args.sprint_id);
        results.sprint_set = args.sprint_id;
      }
      if (args.user_id) {
        await core.setCurrentUser(client, args.user_id);
        results.user_set = args.user_id;
      }
      return jsonResponse({ ...results, preferences: client.workspaceCache.preferences });
    }

    case 'pingcode_context_get': {
      const client = buildClient(args);
      const cache = client.workspaceCache;
      const counts = {
        users: core.pageValues(cache.users).length,
        projects: core.pageValues(cache.projects).length,
        sprints: Object.values(cache.sprints || {}).reduce((s, p) => s + core.pageValues(p).length, 0),
      };
      return jsonResponse({ preferences: cache.preferences, dictionary_counts: counts });
    }

    case 'pingcode_workitem_list': {
      const client = buildClient(args);
      const opts = {
        dry_run: false,
        compact: false,
        all_users: args.all_users || false,
        all_projects: args.all_projects || false,
        all_sprints: args.all_sprints || false,
        user_id: args.user_id || process.env.PINGCODE_USER_ID,
        user_name: args.user_name || process.env.PINGCODE_USER_NAME,
      };
      const tokens = [];
      if (args.state) tokens.push('--state', args.state);
      if (args.type) tokens.push('--type', args.type);
      if (args.assignee) tokens.push('--assignee', args.assignee);
      if (args.project) tokens.push('--project', args.project);
      if (args.sprint) tokens.push('--sprint', args.sprint);
      if (args.keywords) tokens.push('--keywords', args.keywords);
      if (args.limit) tokens.push('--limit', String(args.limit));
      const listArgs = workitemCmd.parseListArgs(tokens);
      const result = await workitemCmd.runList(client, opts, listArgs);
      return jsonResponse(core.compactResponse(result));
    }

    case 'pingcode_workitem_get': {
      const client = buildClient(args);
      const opts = { dry_run: false, compact: false };
      const getArgs = workitemCmd.parseGetArgs([args.id || args.identifier]);
      const result = await workitemCmd.runGet(client, opts, getArgs);
      return jsonResponse(core.compactResponse(result));
    }

    case 'pingcode_workitem_create': {
      const client = buildClient(args);
      const opts = {
        dry_run: false,
        compact: false,
        all_users: args.all_users || false,
        all_projects: args.all_projects || false,
        all_sprints: args.all_sprints || false,
        user_id: args.user_id || process.env.PINGCODE_USER_ID,
      };
      const tokens = ['--title', args.title];
      if (args.type) tokens.push('--type', args.type);
      if (args.project) tokens.push('--project', args.project);
      if (args.sprint) tokens.push('--sprint', args.sprint);
      if (args.assignee) tokens.push('--assignee', args.assignee);
      if (args.state) tokens.push('--state', args.state);
      if (args.priority) tokens.push('--priority', args.priority);
      if (args.description) tokens.push('--description', args.description);
      if (args.parent) tokens.push('--parent', args.parent);
      const createArgs = workitemCmd.parseCreateArgs(tokens);
      const result = await workitemCmd.runCreate(client, opts, createArgs);
      return jsonResponse(core.compactResponse(result));
    }

    case 'pingcode_workitem_update': {
      const client = buildClient(args);
      const opts = {
        dry_run: false,
        compact: false,
        user_id: args.user_id || process.env.PINGCODE_USER_ID,
      };
      const tokens = [args.id || args.identifier];
      if (args.title) tokens.push('--title', args.title);
      if (args.description) tokens.push('--description', args.description);
      if (args.type) tokens.push('--type', args.type);
      if (args.project) tokens.push('--project', args.project);
      if (args.sprint) tokens.push('--sprint', args.sprint);
      if (args.state) tokens.push('--state', args.state);
      if (args.priority) tokens.push('--priority', args.priority);
      if (args.assignee) tokens.push('--assignee', args.assignee);
      if (args.parent) tokens.push('--parent', args.parent);
      if (args.version) tokens.push('--version', args.version);
      if (args.board) tokens.push('--board', args.board);
      if (args.entry) tokens.push('--entry', args.entry);
      if (args.swimlane) tokens.push('--swimlane', args.swimlane);
      if (args.start_at !== undefined) tokens.push('--start-at', String(args.start_at));
      if (args.end_at !== undefined) tokens.push('--end-at', String(args.end_at));
      if (args.participants) tokens.push('--participants', args.participants);
      if (args.story_points !== undefined) tokens.push('--story-points', String(args.story_points));
      if (args.estimated_workload !== undefined) tokens.push('--estimated-workload', String(args.estimated_workload));
      if (args.remaining_workload !== undefined) tokens.push('--remaining-workload', String(args.remaining_workload));
      if (args.properties) tokens.push('--properties', args.properties);
      const updateArgs = workitemCmd.parseUpdateArgs(tokens);
      const result = await workitemCmd.runUpdate(client, opts, updateArgs);
      return jsonResponse(core.compactResponse(result));
    }

    default:
      throw new core.PingCodeError(`Unknown tool: ${name}`);
  }
}

async function runMcpServer() {
  const server = new Server(
    { name: 'better-pingcode', version: pkg.version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await handleTool(request.params.name, request.params.arguments || {});
      return result;
    } catch (exc) {
      const message = exc instanceof core.PingCodeError ? exc.message : exc.message || String(exc);
      return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

module.exports = { runMcpServer };
