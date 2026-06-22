'use strict';

const { debugTool } = require('../tool-registry');

// --- Registry of config sources ---
const configs = new Map();
const configSources = new Map(); // name -> { key: { value, source } }

// Regex for sensitive keys
const SENSITIVE_KEY_RE = /password|secret|token|api.?key|private.?key|credential/i;

/**
 * Mask sensitive values. If the key matches sensitive pattern, return '***'.
 * @param {string} key - The config key
 * @param {*} value - The config value
 * @returns {*} masked value or original
 */
function maskIfSensitive(key, value) {
  if (SENSITIVE_KEY_RE.test(key)) {
    return '***';
  }
  return value;
}

/**
 * Recursively mask sensitive values in a config object.
 * Returns a shallow copy with sensitive values replaced.
 */
function maskConfigObject(obj) {
  if (obj === null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((v, i) => maskConfigObject(v));
  }

  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object') {
      masked[key] = maskConfigObject(value);
    } else {
      masked[key] = maskIfSensitive(key, value);
    }
  }
  return masked;
}

/**
 * Register a config object for inspection.
 * @param {string} name - Identifier for this config (e.g. 'app', 'database')
 * @param {object} configObj - Config values object
 * @param {object} [sources] - Optional source provenance map { key: 'env'|'file'|'default' }
 */
function registerConfig(name, configObj, sources) {
  configs.set(name, configObj);
  if (sources) {
    configSources.set(name, sources);
  }
}

/**
 * Set config source provenance for a named config.
 * @param {string} name - Config name
 * @param {object} sources - { key: 'env'|'file'|'default'|'override' }
 */
function setConfigSources(name, sources) {
  configSources.set(name, sources);
}

// ── get_config_snapshot ─────────────────────────────────────────
debugTool('get_config_snapshot', 'Get all registered config values with automatic masking of sensitive keys (password, secret, token, api_key, private_key, credential). Sensitive values are replaced with "***".', {
  config_name: { type: 'string', description: 'Specific config name to inspect. If omitted, returns all registered configs.', required: false },
  show_sensitive: { type: 'boolean', description: 'If true, show sensitive values unmasked (use with caution). Default: false.', required: false },
})(
  async function getConfigSnapshot({ config_name, show_sensitive }) {
    if (config_name) {
      const cfg = configs.get(config_name);
      if (!cfg) {
        return {
          error: `No config registered with name: ${config_name}`,
          registered_configs: [...configs.keys()],
        };
      }
      return {
        config_name,
        values: show_sensitive ? cfg : maskConfigObject(cfg),
        source: configSources.get(config_name) || null,
      };
    }

    // All configs
    const all = {};
    for (const [name, cfg] of configs) {
      all[name] = show_sensitive ? cfg : maskConfigObject(cfg);
    }

    return {
      config_count: configs.size,
      configs: all,
      note: 'Sensitive keys matching /password|secret|token|api.?key|private.?key|credential/i are masked as "***"',
    };
  }
);

// ── get_env_vars ────────────────────────────────────────────────
debugTool('get_env_vars', 'Get process.env environment variables with optional prefix filter. Sensitive values (password, secret, token, api_key, etc.) are automatically masked as "***".', {
  prefix: { type: 'string', description: 'Only return env vars starting with this prefix (e.g. "REDIS", "DATABASE"). Case-insensitive.', required: false },
  show_sensitive: { type: 'boolean', description: 'If true, show sensitive values unmasked (use with caution). Default: false.', required: false },
})(
  async function getEnvVars({ prefix, show_sensitive }) {
    const vars = {};
    let total = 0;
    let masked = 0;

    for (const [key, value] of Object.entries(process.env)) {
      if (prefix && !key.toLowerCase().startsWith(prefix.toLowerCase())) {
        continue;
      }
      total++;

      if (!show_sensitive && SENSITIVE_KEY_RE.test(key)) {
        vars[key] = '***';
        masked++;
      } else {
        vars[key] = value;
      }
    }

    return {
      total_count: total,
      masked_count: show_sensitive ? 0 : masked,
      prefix: prefix || null,
      variables: vars,
    };
  }
);

// ── get_config_sources ──────────────────────────────────────────
debugTool('get_config_sources', 'Get config provenance: which config values came from which source (environment variable, config file, or default value). Helps debug configuration issues.', {
  config_name: { type: 'string', description: 'Specific config name to inspect. If omitted, returns sources for all registered configs.', required: false },
})(
  async function getConfigSources({ config_name }) {
    if (config_name) {
      const sources = configSources.get(config_name);
      if (!sources) {
        return {
          config_name,
          status: 'No source provenance registered for this config',
          registered_configs: [...configSources.keys()],
          hint: 'Call setConfigSources(name, sources) or pass sources to registerConfig() to track provenance.',
        };
      }

      return {
        config_name,
        sources,
      };
    }

    // All config sources
    const all = {};
    for (const [name, sources] of configSources) {
      all[name] = sources;
    }

    // Also infer sources from env vars that match registered config keys
    const envInferred = {};
    for (const [name, cfg] of configs) {
      if (!configSources.has(name)) {
        const inferred = {};
        for (const key of Object.keys(cfg)) {
          const envKey = key.toUpperCase();
          if (process.env[envKey] !== undefined) {
            inferred[key] = { source: 'env', env_var: envKey };
          } else {
            inferred[key] = { source: 'default' };
          }
        }
        if (Object.keys(inferred).length > 0) {
          envInferred[name] = inferred;
        }
      }
    }

    return {
      registered_source_count: all.length,
      registered_sources: all,
      inferred_from_env: envInferred,
      hint: 'Sources can be: "env" (environment variable), "file" (config file), "default" (hardcoded default), or "override" (runtime override).',
    };
  }
);

module.exports = {
  registerConfig,
  setConfigSources,
  maskIfSensitive,
  maskConfigObject,
  SENSITIVE_KEY_RE,
  configs,
  configSources,
};
