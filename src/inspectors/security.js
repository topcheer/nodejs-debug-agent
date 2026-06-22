'use strict';

const { debugTool } = require('../tool-registry');

// Registry of auth configurations, session stores, and API keys
const authConfigs = new Map();
const sessionStores = new Map();
const apiKeys = new Map();

/**
 * Register an auth configuration for inspection.
 * @param {string} name - Identifier for this auth config (e.g. 'passport', 'jwt')
 * @param {object} config - Auth config object
 */
function registerAuthConfig(name, config) {
  authConfigs.set(name, config);
}

/**
 * Register a session store for active-session inspection.
 * @param {string} name - Identifier for this session store (e.g. 'express-session')
 * @param {object} store - Session store instance (express-session Store, cookie-session, etc.)
 */
function registerSessionStore(name, store) {
  sessionStores.set(name, store);
}

/**
 * Register an API key for masked display.
 * @param {string} name - Identifier for this API key
 * @param {object} keyInfo - { key, scope, permissions }
 */
function registerApiKey(name, keyInfo) {
  apiKeys.set(name, keyInfo);
}

/**
 * Mask an API key for safe display: show first 4 and last 4 chars.
 */
function maskKey(key) {
  if (!key || typeof key !== 'string') return '****';
  if (key.length <= 8) return key.slice(0, 2) + '****';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

// ── get_auth_config ───────────────────────────────────────────────
debugTool('get_auth_config', 'List registered authentication configurations (passport strategies, JWT config, session settings, CORS config). Also auto-discovers passport strategies from require.cache.', {})(
  async function getAuthConfig() {
    const configs = [];

    // Registered configs
    for (const [name, config] of authConfigs) {
      configs.push({ name, config: sanitizeConfig(name, config) });
    }

    // Auto-discover passport strategies from require.cache
    const passport = safeRequire('passport');
    if (passport && passport._strategies) {
      const strategies = [];
      for (const [sname, strategy] of Object.entries(passport._strategies)) {
        strategies.push({
          name: sname,
          type: strategy.name || strategy.constructor?.name || 'unknown',
        });
      }
      if (strategies.length > 0) {
        configs.push({ name: 'passport (auto)', config: { strategies } });
      }
    }

    // Auto-discover CORS config from express app
    try {
      const expressMod = findInCache('express');
      if (expressMod) {
        for (const [id, mod] of Object.entries(require.cache)) {
          const exp = mod.exports;
          if (exp && typeof exp === 'function' && exp._router) {
            // Heuristic: check for CORS headers in settings
            if (exp.settings && exp.settings['x-powered-by'] !== undefined) {
              configs.push({ name: 'express-cors (auto)', config: { powered_by: exp.settings['x-powered-by'] ? 'enabled' : 'disabled' } });
            }
          }
        }
      }
    } catch {}

    if (configs.length === 0) {
      return { status: 'No auth configurations registered. Call registerAuthConfig(name, config) first.' };
    }

    return { config_count: configs.length, configs };
  }
);

/**
 * Sanitize a config object for display, masking secrets.
 */
function sanitizeConfig(name, config) {
  if (!config || typeof config !== 'object') return config;
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof key === 'string' && /secret|password|token|key|private/i.test(key)) {
      result[key] = maskKey(String(value));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeConfig(key, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── get_active_sessions ───────────────────────────────────────────
debugTool('get_active_sessions', 'List active sessions from registered session stores (express-session, cookie-session). Returns session ID, user info, creation time, and expiry.', {
  store_name: { type: 'string', description: 'Specific session store name. If omitted, queries all registered stores.', required: false },
})(
  async function getActiveSessions({ store_name }) {
    const stores = store_name ? [[store_name, sessionStores.get(store_name)]] : [...sessionStores];
    const valid = stores.filter(([name, s]) => s);

    if (valid.length === 0) {
      return { status: 'No session stores registered. Call registerSessionStore(name, store) first.' };
    }

    const results = [];

    for (const [name, store] of valid) {
      try {
        const sessions = await getSessionsFromStore(store);
        results.push({ store: name, session_count: sessions.length, sessions });
      } catch (e) {
        results.push({ store: name, error: e.message });
      }
    }

    return { store_count: results.length, stores: results };
  }
);

/**
 * Extract session info from a session store.
 * Supports express-session Store interface (all/ids/length) and in-memory stores.
 */
async function getSessionsFromStore(store) {
  const sessions = [];

  // express-session MemoryStore has `store.sessions` (a Map/object)
  if (store.sessions) {
    if (store.sessions instanceof Map) {
      for (const [sid, data] of store.sessions) {
        sessions.push(parseSessionEntry(sid, data));
      }
    } else if (typeof store.sessions === 'object') {
      for (const [sid, data] of Object.entries(store.sessions)) {
        sessions.push(parseSessionEntry(sid, data));
      }
    }
    return sessions;
  }

  // express-session Store interface: store.all() or store.ids()
  if (typeof store.all === 'function') {
    const all = await store.all();
    if (all && typeof all === 'object') {
      for (const [sid, data] of Object.entries(all)) {
        sessions.push(parseSessionEntry(sid, data));
      }
    }
    return sessions;
  }

  if (typeof store.ids === 'function') {
    const ids = await store.ids();
    for (const sid of ids) {
      const data = typeof store.get === 'function' ? await store.get(sid) : null;
      sessions.push(parseSessionEntry(sid, data));
    }
    return sessions;
  }

  return [];
}

function parseSessionEntry(sid, data) {
  let parsed = data;
  if (typeof data === 'string') {
    try { parsed = JSON.parse(data); } catch {}
  }

  return {
    session_id: sid,
    user: parsed?.user || parsed?.userId || parsed?.passport?.user || null,
    created_at: parsed?.createdAt || parsed?.cookie?.originalMaxAge ? new Date(Date.now() - (parsed?.cookie?.originalMaxAge || 0)).toISOString() : null,
    expires_at: parsed?.cookie?.expires || parsed?.expires || null,
    cookie: parsed?.cookie ? {
      path: parsed.cookie.path || '/',
      http_only: parsed.cookie.httpOnly !== false,
      secure: parsed.cookie.secure || false,
      max_age: parsed.cookie.maxAge || null,
    } : null,
  };
}

// ── get_api_keys ──────────────────────────────────────────────────
debugTool('get_api_keys', 'List registered API keys (masked) for debugging auth issues. Keys are masked for security, showing only first 4 and last 4 characters.', {})(
  async function getApiKeys() {
    if (apiKeys.size === 0) {
      return { status: 'No API keys registered. Call registerApiKey(name, keyInfo) first.' };
    }

    const keys = [];
    for (const [name, info] of apiKeys) {
      keys.push({
        name,
        key: maskKey(info.key),
        scope: info.scope || 'default',
        permissions: info.permissions || [],
      });
    }

    return { key_count: keys.length, api_keys: keys };
  }
);

// ── Helpers ───────────────────────────────────────────────────────

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

function findInCache(name) {
  for (const [id, mod] of Object.entries(require.cache)) {
    if (id.includes(name)) return mod;
  }
  return null;
}

module.exports = { registerAuthConfig, registerSessionStore, registerApiKey, authConfigs, sessionStores };
