'use strict';

const { debugTool } = require('../tool-registry');

// Registry of Fastify instances for inspection
const fastifyInstances = new Map();

/**
 * Register a Fastify instance for inspection.
 * @param {string|object} nameOrInstance - Instance name (string) or the Fastify instance itself
 * @param {object} [instance] - The Fastify instance (when name is provided)
 */
function registerFastifyInstance(nameOrInstance, instance) {
  if (typeof nameOrInstance === 'string') {
    fastifyInstances.set(nameOrInstance, instance);
  } else {
    fastifyInstances.set('default', nameOrInstance);
  }
}

// ── get_fastify_routes ────────────────────────────────────────────
debugTool('get_fastify_routes', 'Extract all registered routes from Fastify instances including method, URL, handler name, and schema if available', {
  instance_name: { type: 'string', description: 'Name of the registered Fastify instance. If omitted, uses the first registered instance.', required: false },
})(
  async function getFastifyRoutes({ instance_name }) {
    const instance = resolveInstance(instance_name);
    if (!instance) {
      return { error: fastifyInstances.size === 0 ? 'No Fastify instances registered' : `Instance "${instance_name}" not found` };
    }

    // Fastify stores routes under [kRoutes] or via the router
    const routes = [];

    // Method 1: Fastify v4+ stores routes in the internal router
    try {
      const fastifyRoutes = extractFastifyRoutes(instance);
      routes.push(...fastifyRoutes);
    } catch (e) {
      // Method 2: Walk the plugin tree
      try {
        walkFastifyTree(instance, routes, '/');
      } catch (e2) {
        return { error: `Failed to extract routes: ${e.message}` };
      }
    }

    // Deduplicate by method+url
    const seen = new Set();
    const unique = routes.filter(r => {
      const key = `${r.method}:${r.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      framework: 'fastify',
      route_count: unique.length,
      routes: unique,
    };
  }
);

/**
 * Extract routes from a Fastify instance.
 */
function extractFastifyRoutes(instance) {
  const routes = [];

  // Fastify v4: routes are stored in instance[kRoutePrefix] and compiled routes
  // The most reliable way is to check instance[Symbol.for('fastify.routes')] or similar
  if (instance[Symbol.for('fastify.routes')] && Array.isArray(instance[Symbol.for('fastify.routes')])) {
    for (const r of instance[Symbol.for('fastify.routes')]) {
      routes.push(describeFastifyRoute(r));
    }
    return routes;
  }

  // Try the internal _routePrefix approach
  // Fastify v3/v4 exposes routes via the encapsulated contexts
  walkFastifyContexts(instance, '', routes);

  return routes;
}

function walkFastifyContexts(instance, prefix, routes) {
  // Fastify stores child plugin contexts in the internal children array
  // instance[kChildren] or similar internal symbol
  const kChildren = Symbol.for('fastify.children');

  // Get routes from this context
  if (instance.router && typeof instance.router.prettyPrint === 'function') {
    try {
      const printed = instance.router.prettyPrint({ commonPrefix: false, includeMeta: true });
      // Parse the pretty-printed tree to extract routes
      for (const line of printed.split('\n')) {
        const match = line.match(/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s`]*)/);
        if (match) {
          routes.push({
            method: match[1],
            url: prefix + match[2],
            handler: extractHandlerName(line),
          });
        }
      }
    } catch (e) {}
  }

  // Walk children
  const children = instance[kChildren];
  if (children && typeof children.forEach === 'function') {
    children.forEach(child => {
      const childPrefix = (prefix || '') + (child.prefix || '');
      walkFastifyContexts(child, childPrefix, routes);
    });
  }
}

function walkFastifyTree(instance, routes, prefix) {
  // Alternative: use printRoutes if available
  if (typeof instance.printRoutes === 'function') {
    try {
      const printed = instance.printRoutes({ commonPrefix: false });
      for (const line of printed.split('\n')) {
        const match = line.match(/(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s`]*)/);
        if (match) {
          routes.push({
            method: match[1],
            url: prefix + match[2],
            handler: extractHandlerName(line),
          });
        }
      }
    } catch (e) {}
  }
}

function describeFastifyRoute(r) {
  const route = {
    method: Array.isArray(r.method) ? r.method.join(', ') : (r.method || r.methods?.join(', ') || 'UNKNOWN'),
    url: r.url || r.path || '',
    handler: r.handler ? (r.handler.name || 'anonymous') : undefined,
  };

  if (r.schema) {
    route.schema = {
      body: r.schema.body ? Object.keys(r.schema.body.properties || {}) : undefined,
      querystring: r.schema.querystring ? Object.keys(r.schema.querystring.properties || {}) : undefined,
      params: r.schema.params ? Object.keys(r.schema.params.properties || {}) : undefined,
      response: r.schema.response ? Object.keys(r.schema.response) : undefined,
    };
  }

  if (r.prefix) route.prefix = r.prefix;
  return route;
}

function extractHandlerName(line) {
  const match = line.match(/`([^`]+)`/);
  if (match) return match[1];
  // Try to extract function name after the path
  const parts = line.trim().split(/\s+/);
  return parts.length > 2 ? parts[parts.length - 1] : 'anonymous';
}

// ── get_fastify_plugins ───────────────────────────────────────────
debugTool('get_fastify_plugins', 'List all registered Fastify plugins and decorators from the instance', {
  instance_name: { type: 'string', description: 'Name of the registered Fastify instance. If omitted, uses the first registered instance.', required: false },
})(
  async function getFastifyPlugins({ instance_name }) {
    const instance = resolveInstance(instance_name);
    if (!instance) {
      return { error: fastifyInstances.size === 0 ? 'No Fastify instances registered' : `Instance "${instance_name}" not found` };
    }

    const result = {
      framework: 'fastify',
      plugins: [],
      decorators: {},
    };

    // Extract registered plugins from the internal plugin meta
    // Fastify stores this in instance[kPluginMeta] or similar
    try {
      const kRegisteredPlugins = Symbol.for('registered-plugins');
      if (instance[kRegisteredPlugins]) {
        for (const [name, meta] of instance[kRegisteredPlugins]) {
          result.plugins.push({ name, version: meta?.version });
        }
      }
    } catch (e) {}

    // Try the public API: instance.pluginName or iterate decorators
    try {
      // Fastify exposes decorators
      const decorators = collectFastifyDecorators(instance);
      if (Object.keys(decorators).length > 0) {
        result.decorators = decorators;
      }
    } catch (e) {}

    // Try to list plugins from the avvio container
    try {
      if (instance.pluginMeta && typeof instance.pluginMeta === 'object') {
        for (const [name, meta] of Object.entries(instance.pluginMeta)) {
          if (!result.plugins.find(p => p.name === name)) {
            result.plugins.push({ name, version: meta.version || meta });
          }
        }
      }
    } catch (e) {}

    // Fallback: scan require.cache for fastify plugin patterns
    if (result.plugins.length === 0) {
      result.plugins = scanForFastifyPlugins(instance);
    }

    result.plugin_count = result.plugins.length;
    return result;
  }
);

function collectFastifyDecorators(instance) {
  const decorators = {};

  // Fastify decorator lists
  const categories = ['decorate', 'decorateRequest', 'decorateReply'];
  for (const cat of categories) {
    if (instance[cat] && instance[cat].original) {
      try {
        // Access the store of decorated properties
        const store = instance[cat].store || {};
        if (Object.keys(store).length > 0) {
          decorators[cat] = Object.keys(store);
        }
      } catch (e) {}
    }
  }

  return decorators;
}

function scanForFastifyPlugins(instance) {
  const plugins = [];
  // Look at the instance's own properties for plugin registration hints
  for (const key of Object.getOwnPropertyNames(instance)) {
    if (key.startsWith('fastify-') || key.includes('plugin')) {
      plugins.push({ name: key });
    }
  }
  return plugins;
}

// ── Helpers ───────────────────────────────────────────────────────

function resolveInstance(name) {
  if (name) return fastifyInstances.get(name);
  for (const [, inst] of fastifyInstances) return inst;
  return null;
}

module.exports = { registerFastifyInstance, fastifyInstances };
