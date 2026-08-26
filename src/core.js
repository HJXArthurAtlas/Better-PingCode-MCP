'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const DEFAULT_BASE_URL = 'https://open.pingcode.com';
const DEFAULT_TOKEN_CACHE = '~/.cache/bpingcode/token.json';
const DEFAULT_WORKSPACE_CACHE = '.bpingcode/cache.json';
const MAX_TOKEN_TTL_SECONDS = 29 * 24 * 60 * 60;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

class PingCodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PingCodeError';
  }
}

function emptyWorkspaceCache() {
  return {
    version: 1,
    preferences: {},
    users: null,
    projects: null,
    sprints: {},
    work_item_types: {},
    work_item_priorities: {},
    work_item_states: {},
    work_item_properties: {},
  };
}

function parseJsonObject(raw, label) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (exc) {
    throw new PingCodeError(`${label} must be valid JSON: ${exc.message}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new PingCodeError(`${label} must be a JSON object`);
  }
  return data;
}

function parseKeyValues(items) {
  const result = {};
  for (const item of items || []) {
    const index = item.indexOf('=');
    if (index === -1) throw new PingCodeError(`Expected key=value, got: ${item}`);
    const key = item.slice(0, index).trim();
    if (!key) throw new PingCodeError(`Empty key in parameter: ${item}`);
    result[key] = item.slice(index + 1);
  }
  return result;
}

function expandUserPath(value) {
  if (!value) return value;
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function loadWorkspaceCache(cachePath) {
  if (!cachePath) return emptyWorkspaceCache();
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (_) {
    return emptyWorkspaceCache();
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyWorkspaceCache();
  }
  return { ...emptyWorkspaceCache(), ...payload };
}

function mergeWorkspaceCache(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const existingValue = merged[key];
    if (
      existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue) &&
      value && typeof value === 'object' && !Array.isArray(value)
    ) {
      merged[key] = mergeWorkspaceCache(existingValue, value);
    } else if (value === null && existingValue !== null && existingValue !== undefined) {
      continue;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function compactWorkspaceCacheValue(value) {
  const dropKeys = new Set([
    'avatar', 'color', 'created_at', 'created_by', 'description', 'email',
    'is_archived', 'is_deleted', 'members', 'scope_id', 'scope_type',
    'updated_at', 'updated_by', 'url', 'visibility',
  ]);
  if (Array.isArray(value)) return value.map(compactWorkspaceCacheValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (dropKeys.has(key)) continue;
      result[key] = compactWorkspaceCacheValue(item);
    }
    return result;
  }
  return value;
}

function saveWorkspaceCache(cachePath, cache) {
  if (!cachePath) throw new PingCodeError('Workspace cache is disabled');
  let latest = loadWorkspaceCache(cachePath);
  cache = mergeWorkspaceCache(latest, cache);
  cache = compactWorkspaceCacheValue(cache);
  cache.updated_at = Math.floor(Date.now() / 1000);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmpName = `.${path.basename(cachePath)}.${process.pid}.${crypto.randomUUID().replace(/-/g, '')}.tmp`;
  const tmpPath = path.join(path.dirname(cachePath), tmpName);
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2) + '\n');
  fs.renameSync(tmpPath, cachePath);
  try {
    fs.chmodSync(cachePath, 0o600);
  } catch (_) {}
}

function currentUserId(userId, workspaceCache) {
  const preferences = (workspaceCache || {}).preferences || {};
  userId = userId || process.env.PINGCODE_USER_ID || preferences.current_user_id;
  if (!userId) throw new PingCodeError('Missing current user. Configure PINGCODE_USER_ID or run `pingcode context init`.');
  return userId;
}

function currentUserName(userName, workspaceCache) {
  const preferences = (workspaceCache || {}).preferences || {};
  userName = userName || process.env.PINGCODE_USER_NAME || preferences.current_user_name;
  if (!userName) throw new PingCodeError('Missing current user name. Configure PINGCODE_USER_NAME or run `pingcode context init`.');
  return userName;
}

function pageValues(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  if (Array.isArray(payload.values)) return payload.values;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function nestedText(value, key) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value[key] === 'string') return value[key];
    if (typeof value.display_name === 'string') return value.display_name;
    if (typeof value.name === 'string') return value.name;
    if (typeof value.title === 'string') return value.title;
    if (typeof value.identifier === 'string') return value.identifier;
  }
  return String(value);
}

function compactBusinessItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const result = {};
  const keep = new Set([
    'id', 'identifier', 'short_id', 'type', 'title', 'name', 'display_name',
    'state', 'priority', 'project', 'sprint', 'parent', 'assignee', 'html_url',
    'product', 'suite', 'plan',
  ]);
  for (const key of Object.keys(item)) {
    if (!keep.has(key)) continue;
    const value = item[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const text = nestedText(value);
      if (text) {
        result[key] = text;
        continue;
      }
      const mini = {};
      for (const k of ['id', 'identifier', 'name', 'display_name', 'title']) {
        if (typeof value[k] === 'string') mini[k] = value[k];
      }
      result[key] = mini;
    } else {
      result[key] = value;
    }
  }
  if (item.state && typeof item.state === 'object') {
    result.state_type = item.state.type || item.state.state_type;
  }
  if (item.parent && typeof item.parent === 'object') {
    result.parent_identifier = item.parent.identifier;
    result.parent_title = item.parent.title;
    result.parent_id = item.parent.id;
  }
  return result;
}

function compactResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return compactBusinessItem(payload);
  }
  const values = pageValues(payload);
  if (values.length > 0) {
    return {
      page_size: payload.page_size,
      page_index: payload.page_index,
      total: payload.total,
      count: values.length,
      values: values.map(compactBusinessItem),
    };
  }
  return compactBusinessItem(payload);
}

function normalizedEntity(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const result = { ...item };
  if (item.user && typeof item.user === 'object' && !Array.isArray(item.user)) {
    Object.assign(result, item.user);
  }
  return result;
}

function itemNames(item) {
  const entity = normalizedEntity(item);
  const names = [];
  for (const key of ['display_name', 'name', 'title', 'identifier', 'id', 'email', 'username']) {
    if (typeof entity[key] === 'string' && entity[key]) names.push(entity[key]);
  }
  return names;
}

function displayName(item) {
  const entity = normalizedEntity(item);
  return entity.display_name || entity.name || entity.title || entity.identifier || entity.id || 'Unknown';
}

function itemId(item, label) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    if (typeof item.id === 'string') return item.id;
    if (typeof item.identifier === 'string') return item.identifier;
  }
  throw new PingCodeError(`Item has no id for ${label}`);
}

function findCachedItem(items, query, label) {
  if (!Array.isArray(items)) throw new PingCodeError(`No cached ${label} items`);
  const trimmed = String(query).trim();

  const exact = items.find((item) => {
    const names = itemNames(item);
    return names.some((n) => n === trimmed);
  });
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  const partial = items.filter((item) => {
    const names = itemNames(item);
    return names.some((n) => n.toLowerCase().includes(lower));
  });

  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new PingCodeError(
      `Ambiguous ${label} match for "${query}". Matches: ${partial.map(displayName).join(', ')}`
    );
  }

  const raw = items.find((item) => item.id === trimmed);
  if (raw) return raw;

  throw new PingCodeError(`No ${label} found matching "${query}"`);
}

function cachedUserId(query, workspaceCache) {
  const users = pageValues(workspaceCache.users);
  const found = findCachedItem(users, query, 'user');
  return found.id;
}

function expandIdentityPlaceholder(value, userId, userName, workspaceCache) {
  if (typeof value === 'string') {
    if (value === '@me') return currentUserId(userId, workspaceCache);
    if (value === '@me_name' || value === '@me-name') return currentUserName(userName, workspaceCache);
    if (value.includes('@user:')) {
      return value.replace(/@user:([^,\s]+)/g, (_, name) => cachedUserId(name, workspaceCache));
    }
    if (value.includes('@me')) {
      return value.replace(/@me/g, currentUserId(userId, workspaceCache));
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandIdentityPlaceholder(v, userId, userName, workspaceCache));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = expandIdentityPlaceholder(v, userId, userName, workspaceCache);
    }
    return result;
  }
  return value;
}

function expandIdentityPlaceholders(data, userId, userName, workspaceCache) {
  if (data === null || data === undefined) return data;
  return expandIdentityPlaceholder(data, userId, userName, workspaceCache);
}

function readRawTokenCache(cachePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch (_) {}
  return null;
}

function loadCachedToken(cachePath) {
  const raw = readRawTokenCache(cachePath);
  if (!raw) return null;
  const { access_token, expires_at, grant_type, refresh_token } = raw;
  if (typeof access_token !== 'string' || !access_token) return null;
  if (typeof expires_at === 'number' && expires_at <= Math.floor(Date.now() / 1000)) return null;
  return { access_token, expires_at, grant_type, refresh_token };
}

function saveCachedToken(cachePath, token, expiresIn, grantType = 'client_credentials', refreshToken = null) {
  if (!cachePath) return;
  let ttl = typeof expiresIn === 'number' ? expiresIn : MAX_TOKEN_TTL_SECONDS;
  ttl = Math.max(60, Math.min(ttl, MAX_TOKEN_TTL_SECONDS));
  const payload = {
    grant_type: grantType,
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + ttl,
    created_at: Math.floor(Date.now() / 1000),
  };
  if (typeof refreshToken === 'string' && refreshToken) payload.refresh_token = refreshToken;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmpName = `.${path.basename(cachePath)}.${process.pid}.${crypto.randomUUID().replace(/-/g, '')}.tmp`;
  const tmpPath = path.join(path.dirname(cachePath), tmpName);
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(tmpPath, cachePath);
  try {
    fs.chmodSync(cachePath, 0o600);
  } catch (_) {}
}

function buildUrl(baseUrl, rawPath, params) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanPath = rawPath.replace(/^\//, '');
  const url = new URL(`${cleanBase}/${cleanPath}`);
  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        url.searchParams.append(key, value.join(','));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

function normalizePath(rawPath, baseUrl = DEFAULT_BASE_URL) {
  const base = new URL(baseUrl);
  const url = new URL(rawPath, base);
  return url.pathname;
}

function cachedResponse(method, rawPath, params, workspaceCache, baseUrl) {
  if (method !== 'GET') return null;
  const norm = normalizePath(rawPath, baseUrl);
  const p = params || {};

  if (norm === '/v1/project/projects') return workspaceCache.projects;
  if (norm === '/v1/directory/users') return workspaceCache.users;

  const membersMatch = norm.match(/^\/v1\/project\/projects\/([^/]+)\/members$/);
  if (membersMatch) {
    const cachedUsers = workspaceCache.users;
    if (cachedUsers && (cachedUsers.project_id === undefined || cachedUsers.project_id === membersMatch[1])) {
      return cachedUsers;
    }
  }

  const sprintsMatch = norm.match(/^\/v1\/project\/projects\/([^/]+)\/sprints$/);
  if (sprintsMatch) return workspaceCache.sprints[sprintsMatch[1]];

  if (norm === '/v1/project/work_item/types') return workspaceCache.work_item_types[p.project_id];
  if (norm === '/v1/project/work_item/priorities') return workspaceCache.work_item_priorities[p.project_id];
  if (norm === '/v1/project/work_item/states') return workspaceCache.work_item_states[`${p.project_id}::${p.work_item_type_id}`];
  if (norm === '/v1/project/work_item/properties') return workspaceCache.work_item_properties[`${p.project_id}::${p.work_item_type_id}`];

  return null;
}

function updateWorkspaceCacheForResponse(method, rawPath, params, response, workspaceCache, baseUrl) {
  if (method !== 'GET' || !response || typeof response !== 'object' || Array.isArray(response)) return false;
  const norm = normalizePath(rawPath, baseUrl);
  const p = params || {};
  let updated = false;

  if (norm === '/v1/project/projects') {
    workspaceCache.projects = response;
    updated = true;
  } else if (norm === '/v1/directory/users') {
    workspaceCache.users = response;
    workspaceCache.users.project_id = null;
    updated = true;
  } else if (/^\/v1\/project\/projects\/([^/]+)\/members$/.test(norm)) {
    workspaceCache.users = response;
    workspaceCache.users.project_id = norm.match(/^\/v1\/project\/projects\/([^/]+)\/members$/)[1];
    updated = true;
  } else if (/^\/v1\/project\/projects\/([^/]+)\/sprints$/.test(norm)) {
    const pid = norm.match(/^\/v1\/project\/projects\/([^/]+)\/sprints$/)[1];
    workspaceCache.sprints[pid] = response;
    updated = true;
  } else if (norm === '/v1/project/work_item/types') {
    workspaceCache.work_item_types[p.project_id] = response;
    updated = true;
  } else if (norm === '/v1/project/work_item/priorities') {
    workspaceCache.work_item_priorities[p.project_id] = response;
    updated = true;
  } else if (norm === '/v1/project/work_item/states') {
    workspaceCache.work_item_states[`${p.project_id}::${p.work_item_type_id}`] = response;
    updated = true;
  } else if (norm === '/v1/project/work_item/properties') {
    workspaceCache.work_item_properties[`${p.project_id}::${p.work_item_type_id}`] = response;
    updated = true;
  }

  return updated;
}

function pathIsListWorkItems(rawPath, baseUrl = DEFAULT_BASE_URL) {
  return normalizePath(rawPath, baseUrl) === '/v1/project/work_items';
}

class PingCodeClient {
  constructor({
    base_url,
    client_id = null,
    client_secret = null,
    token = null,
    token_cache = DEFAULT_TOKEN_CACHE,
    workspace_cache = DEFAULT_WORKSPACE_CACHE,
    grant_type = 'auto',
  } = {}) {
    this.baseUrl = (base_url || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.clientId = client_id || process.env.PINGCODE_CLIENT_ID || null;
    this.clientSecret = client_secret || process.env.PINGCODE_CLIENT_SECRET || null;
    this.token = token;
    this.tokenCache = token_cache ? expandUserPath(token_cache) : null;
    this.workspaceCachePath = workspace_cache ? expandUserPath(workspace_cache) : null;
    this.workspaceCache = loadWorkspaceCache(this.workspaceCachePath);
    this.grantType = grant_type;
  }

  resolveGrantType() {
    if (this.grantType !== 'auto') return this.grantType;
    if (this.tokenCache) {
      const raw = readRawTokenCache(this.tokenCache);
      if (raw && typeof raw.grant_type === 'string') return raw.grant_type;
    }
    return 'client_credentials';
  }

  async accessToken() {
    const grantType = this.resolveGrantType();
    if (this.token) return this.token;
    if (this.tokenCache) {
      const cached = loadCachedToken(this.tokenCache);
      if (cached) {
        if (cached.grant_type !== grantType) {
          throw new PingCodeError(
            `Cached token grant_type '${cached.grant_type}' does not match configured '${grantType}'. Remove the token cache and re-authenticate.`
          );
        }
        this.token = cached.access_token;
        return cached.access_token;
      }
      if (grantType === 'authorization_code') {
        const raw = readRawTokenCache(this.tokenCache);
        if (raw && typeof raw.refresh_token === 'string' && raw.refresh_token) {
          return this.refreshAccessToken(raw.refresh_token);
        }
      }
    }

    if (grantType === 'client_credentials') {
      if (!this.clientId || !this.clientSecret) {
        throw new PingCodeError(
          'Missing credentials. Set PINGCODE_CLIENT_ID and PINGCODE_CLIENT_SECRET, or pass --client-id/--client-secret.'
        );
      }
      const response = await this.rawRequest(
        'GET',
        '/v1/auth/token',
        {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        null,
        false,
      );
      const token = response.access_token;
      if (typeof token !== 'string' || !token) {
        throw new PingCodeError('Token response did not include access_token');
      }
      this.token = token;
      if (this.tokenCache) {
        saveCachedToken(this.tokenCache, token, response.expires_in, 'client_credentials');
      }
      return token;
    }

    if (grantType === 'authorization_code') {
      throw new PingCodeError('No valid user token available. Run `pingcode auth login` to authenticate.');
    }
    throw new PingCodeError(`Unsupported grant_type: ${grantType}`);
  }

  async exchangeAuthorizationCode(code, redirectUri) {
    const params = {
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (redirectUri) params.redirect_uri = redirectUri;
    const response = await this.rawRequest('GET', '/v1/auth/token', params, null, false);
    const accessToken = response.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new PingCodeError('Token response did not include access_token');
    }
    this.token = accessToken;
    const refreshToken = typeof response.refresh_token === 'string' ? response.refresh_token : null;
    if (this.tokenCache) {
      saveCachedToken(this.tokenCache, accessToken, response.expires_in, 'authorization_code', refreshToken);
    }
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async refreshAccessToken(refreshToken) {
    const response = await this.rawRequest(
      'GET',
      '/v1/auth/token',
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      null,
      false,
    );
    const accessToken = response.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      throw new PingCodeError('Token refresh response did not include access_token');
    }
    this.token = accessToken;
    const newRefreshToken = typeof response.refresh_token === 'string' ? response.refresh_token : refreshToken;
    if (this.tokenCache) {
      saveCachedToken(this.tokenCache, accessToken, response.expires_in, 'authorization_code', newRefreshToken);
    }
    return accessToken;
  }

  buildAuthorizationUrl(redirectUri, state) {
    return buildUrl(this.baseUrl, '/oauth2/authorize', {
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
    });
  }

  async rawRequest(method, rawPath, params = null, body = null, auth = true) {
    const url = buildUrl(this.baseUrl, rawPath, params);
    const headers = { Accept: 'application/json' };
    let fetchBody = undefined;
    if (body !== null && body !== undefined) {
      if (body instanceof FormData) {
        fetchBody = body;
      } else {
        fetchBody = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      }
    }
    if (auth) {
      headers.Authorization = `Bearer ${await this.accessToken()}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal: controller.signal,
      });
      const content = await response.text();
      if (!response.ok) {
        const retryAfter = response.headers.get('x-pc-retry-after');
        const suffix = retryAfter ? ` retry_after=${retryAfter}` : '';
        throw new PingCodeError(`HTTP ${response.status} ${response.statusText}.${suffix} ${content}`);
      }
      if (!content) return {};
      try {
        const parsed = JSON.parse(content);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { value: parsed };
        }
        return parsed;
      } catch (exc) {
        throw new PingCodeError(`Response was not JSON: ${content.slice(0, 300)}`);
      }
    } catch (exc) {
      if (exc instanceof PingCodeError) throw exc;
      throw new PingCodeError(`Request failed: ${exc.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  async request(method, rawPath, params = null, body = null, { dry_run = false, use_workspace_cache = true } = {}) {
    method = method.toUpperCase();
    if (!HTTP_METHODS.includes(method)) throw new PingCodeError(`Unsupported method: ${method}`);
    if (dry_run) {
      return {
        dry_run: true,
        method,
        url: buildUrl(this.baseUrl, rawPath, params),
        path: rawPath,
        params: params || {},
        json: body,
      };
    }

    const requestParams = params || {};
    if (use_workspace_cache) {
      const cached = cachedResponse(method, rawPath, requestParams, this.workspaceCache, this.baseUrl);
      if (cached !== null) return cached;
    }

    const response = await this.rawRequest(method, rawPath, params, body);
    if (
      this.workspaceCachePath !== null &&
      updateWorkspaceCacheForResponse(method, rawPath, requestParams, response, this.workspaceCache, this.baseUrl)
    ) {
      saveWorkspaceCache(this.workspaceCachePath, this.workspaceCache);
    }
    return response;
  }

  saveWorkspaceCache() {
    if (this.workspaceCachePath) saveWorkspaceCache(this.workspaceCachePath, this.workspaceCache);
  }

  async fetchProjectUsers(projectId) {
    const encoded = encodeURIComponent(projectId);
    const rawPath = `/v1/project/projects/${encoded}/members`;
    const response = await this.request('GET', rawPath, {}, null, { use_workspace_cache: false });
    return response;
  }
}

const DEFAULT_PAGE_SIZE = 100;

async function fetchAllPages(client, rawPath, params = {}) {
  const allValues = [];
  let pageIndex = 0;
  let total = null;
  while (true) {
    const pageParams = { ...params, page_index: pageIndex, page_size: DEFAULT_PAGE_SIZE };
    const response = await client.request('GET', rawPath, pageParams, null, { use_workspace_cache: false });
    const values = pageValues(response);
    allValues.push(...values);
    if (typeof response.total === 'number') total = response.total;
    if (values.length < DEFAULT_PAGE_SIZE) break;
    pageIndex += 1;
    if (total !== null && allValues.length >= total) break;
  }
  return {
    page_size: DEFAULT_PAGE_SIZE,
    page_index: 0,
    total: total ?? allValues.length,
    values: allValues,
  };
}

async function refreshCommand(client, rawPath, params = null) {
  const response = await fetchAllPages(client, rawPath, params || {});
  if (
    client.workspaceCachePath !== null &&
    updateWorkspaceCacheForResponse('GET', rawPath, params || {}, response, client.workspaceCache, client.baseUrl)
  ) {
    saveWorkspaceCache(client.workspaceCachePath, client.workspaceCache);
  }
  return response;
}

async function cacheProjects(client) {
  return refreshCommand(client, '/v1/project/projects', {});
}

async function cacheSprints(client, projectId) {
  const encoded = encodeURIComponent(projectId);
  return refreshCommand(client, `/v1/project/projects/${encoded}/sprints`, {});
}

async function cacheWorkItemTypes(client, projectId) {
  return refreshCommand(client, '/v1/project/work_item/types', { project_id: projectId });
}

async function cacheWorkItemPriorities(client, projectId) {
  return refreshCommand(client, '/v1/project/work_item/priorities', { project_id: projectId });
}

async function cacheWorkItemStates(client, projectId, workItemTypeId) {
  return refreshCommand(client, '/v1/project/work_item/states', {
    project_id: projectId,
    work_item_type_id: workItemTypeId,
  });
}

async function cacheWorkItemProperties(client, projectId, workItemTypeId) {
  return refreshCommand(client, '/v1/project/work_item/properties', {
    project_id: projectId,
    work_item_type_id: workItemTypeId,
  });
}

async function cacheProjectDictionaries(client, projectId) {
  const types = await cacheWorkItemTypes(client, projectId);
  const values = pageValues(types);
  await Promise.all(
    values.map((type) =>
      Promise.all([
        cacheWorkItemStates(client, projectId, type.id),
        cacheWorkItemProperties(client, projectId, type.id),
      ])
    )
  );
  await cacheWorkItemPriorities(client, projectId);
  return true;
}

async function cacheUsers(client, projectId = null) {
  if (projectId) {
    return client.fetchProjectUsers(projectId);
  }
  return refreshCommand(client, '/v1/directory/users', {});
}

async function setCurrentUser(client, userId) {
  const users = pageValues(client.workspaceCache.users);
  const user = findCachedItem(users, userId, 'user');
  client.workspaceCache.preferences.current_user_id = user.id;
  client.workspaceCache.preferences.current_user_name = displayName(user);
  client.saveWorkspaceCache();
  return { ...client.workspaceCache.preferences };
}

async function setCurrentProject(client, projectId) {
  const projects = pageValues(client.workspaceCache.projects);
  const project = findCachedItem(projects, projectId, 'project');
  client.workspaceCache.preferences.current_project_id = project.id;
  client.workspaceCache.preferences.current_project_name = displayName(project);
  client.saveWorkspaceCache();
  return { ...client.workspaceCache.preferences };
}

async function setCurrentSprint(client, sprintId) {
  const allSprints = [];
  for (const payload of Object.values(client.workspaceCache.sprints || {})) {
    allSprints.push(...pageValues(payload));
  }
  const sprint = findCachedItem(allSprints, sprintId, 'sprint');
  client.workspaceCache.preferences.current_sprint_id = sprint.id;
  client.workspaceCache.preferences.current_sprint_name = displayName(sprint);
  client.saveWorkspaceCache();
  return { ...client.workspaceCache.preferences };
}

function applyDefaultWorkItemFilters(rawPath, params, client, userId, userName, currentUser = true, allProjects = false, allSprints = false) {
  if (!pathIsListWorkItems(rawPath)) return params;
  const result = { ...params };
  const cache = client.workspaceCache;

  if (currentUser && !result.assignee_ids) {
    result.assignee_ids = currentUserId(userId, cache);
  }
  if (!allProjects && !result.project_ids) {
    const pid = cache.preferences.current_project_id;
    if (!pid) throw new PingCodeError('Workspace context incomplete. Run `pingcode context init`.');
    result.project_ids = pid;
  }
  if (!allSprints && !result.sprint_ids) {
    const sid = cache.preferences.current_sprint_id;
    if (!sid) throw new PingCodeError('Workspace context incomplete. Run `pingcode context init`.');
    result.sprint_ids = sid;
  }
  return expandIdentityPlaceholders(result, userId, userName, cache);
}

function ensureWorkItemWorkspaceContext(rawPath, client, method = 'GET', currentUser = true, allProjects = false, allSprints = false) {
  if (!pathIsListWorkItems(rawPath)) return;
  if (method !== 'GET' && method !== 'POST') return;
  const missing = [];
  const prefs = client.workspaceCache.preferences || {};
  if (currentUser && !prefs.current_user_id) missing.push('current_user_id');
  if (!allProjects && !prefs.current_project_id) missing.push('current_project_id');
  if (!allSprints && !prefs.current_sprint_id) missing.push('current_sprint_id');
  if (missing.length) {
    throw new PingCodeError(
      `Workspace context incomplete (missing: ${missing.join(', ')}). Run \`pingcode context init\`.`
    );
  }
}

function applyDefaultWorkItemCreateBody(method, rawPath, body, client, userId, currentUser = true) {
  if (method !== 'POST' || !pathIsListWorkItems(rawPath)) return body;
  const result = { ...body };
  if (currentUser && !result.assignee_id) {
    result.assignee_id = currentUserId(userId, client.workspaceCache);
  }
  return result;
}

async function resolveWorkItemIdentifier(client, identifier) {
  const response = await client.request(
    'GET',
    '/v1/project/work_items',
    { identifier },
    null,
    { use_workspace_cache: true },
  );
  const values = pageValues(response);
  if (values.length === 0) throw new PingCodeError(`No work item found with identifier ${identifier}`);
  return values[0].id;
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    const keys = Object.keys(value).sort();
    for (const key of keys) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

function startAuthCallbackServer({ port, path: callbackPath, state, timeoutMs = 120000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pendingResult = null;

    function finish(action, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingResult = { action, value };
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => {
        if (action === 'resolve') resolve(value);
        else reject(value);
      });
    }

    const server = http.createServer((req, res) => {
      res.setHeader('Connection', 'close');
      const callbackUrl = new URL(req.url, 'http://127.0.0.1');

      if (callbackUrl.pathname !== callbackPath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = callbackUrl.searchParams.get('code');
      const oauthError = callbackUrl.searchParams.get('error');

      if (oauthError) {
        const errorDescription = callbackUrl.searchParams.get('error_description') || '';
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h1>Authentication Error</h1>' +
          `<p>${escapeHtml(oauthError)}${errorDescription ? ': ' + escapeHtml(errorDescription) : ''}</p>` +
          '<p>You can close this window.</p></body></html>'
        );
        finish('reject', new PingCodeError(`OAuth error: ${oauthError}${errorDescription ? ' - ' + errorDescription : ''}`));
        return;
      }

      const returnedState = callbackUrl.searchParams.get('state');
      if (returnedState && returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h1>State Mismatch</h1>' +
          '<p>The state parameter does not match.</p>' +
          '<p>You can close this window.</p></body></html>'
        );
        finish('reject', new PingCodeError(`State mismatch: expected '${state}', got '${returnedState}'`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h1>Authentication Successful</h1>' +
          '<p>You can close this window.</p></body></html>'
        );
        finish('resolve', { code, state: returnedState || state });
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body><h1>Bad Request</h1>' +
        '<p>Missing authorization code.</p>' +
        '<p>You can close this window.</p></body></html>'
      );
      finish('reject', new PingCodeError('No authorization code in callback'));
    });

    const timer = setTimeout(() => {
      finish('reject', new PingCodeError(`OAuth callback timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    server.on('error', (err) => {
      finish('reject', new PingCodeError(`Callback server error: ${err.message}`));
    });

    server.listen(port, '127.0.0.1');
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFileUploadForm(filePath, title) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new PingCodeError(`File not found: ${filePath}`);
  const stats = fs.statSync(resolved);
  if (!stats.isFile()) throw new PingCodeError(`Path is not a file: ${filePath}`);
  const buffer = fs.readFileSync(resolved);
  const form = new FormData();
  form.append('title', title);
  form.append('file', new Blob([buffer]), path.basename(resolved));
  return form;
}

module.exports = {
  PingCodeError,
  PingCodeClient,
  DEFAULT_BASE_URL,
  DEFAULT_TOKEN_CACHE,
  DEFAULT_WORKSPACE_CACHE,
  HTTP_METHODS,
  emptyWorkspaceCache,
  parseJsonObject,
  parseKeyValues,
  expandUserPath,
  loadWorkspaceCache,
  saveWorkspaceCache,
  currentUserId,
  currentUserName,
  pageValues,
  nestedText,
  compactBusinessItem,
  compactResponse,
  normalizedEntity,
  itemNames,
  displayName,
  itemId,
  findCachedItem,
  cachedUserId,
  expandIdentityPlaceholder,
  expandIdentityPlaceholders,
  readRawTokenCache,
  loadCachedToken,
  saveCachedToken,
  buildUrl,
  normalizePath,
  cachedResponse,
  updateWorkspaceCacheForResponse,
  pathIsListWorkItems,
  startAuthCallbackServer,
  refreshCommand,
  cacheProjects,
  cacheSprints,
  cacheWorkItemTypes,
  cacheWorkItemPriorities,
  cacheWorkItemStates,
  cacheWorkItemProperties,
  cacheProjectDictionaries,
  cacheUsers,
  setCurrentUser,
  setCurrentProject,
  setCurrentSprint,
  applyDefaultWorkItemFilters,
  ensureWorkItemWorkspaceContext,
  applyDefaultWorkItemCreateBody,
  resolveWorkItemIdentifier,
  printJson,
  sortKeys,
  buildFileUploadForm,
  fetchAllPages,
};
