'use strict';

const { debugTool } = require('../tool-registry');

// Registry of Express apps for inspection
const expressApps = new Map();
let _defaultApp = null;

/**
 * Register an Express app for route/middleware inspection.
 * @param {string|object} nameOrApp - App name (string) or the Express app itself
 * @param {object} [app] - The Express app (when name is provided)
 */
function registerExpressApp(nameOrApp, app) {
  if (typeof nameOrApp === 'string') {
    expressApps.set(nameOrApp, app);
  } else {
    // Called with just the app
    _defaultApp = nameOrApp;
    expressApps.set('default', nameOrApp);
  }
}

/**
 * Set the default Express app (auto-called from middleware integration if available).
 */
function setExpressApp(app) {
  _defaultApp = app;
  if (app) expressApps.set('app', app);
}

// ── get_express_routes ────────────────────────────────────────────
debugTool('get_express_routes', 'Extract the full route tree from registered Express apps including router mounts, middleware chains, route params, and regex patterns. Walks app._router.stack recursively.', {
  app_name: { type: 'string', description: 'Name of the registered Express app to inspect. If omitted, uses the default.', required: false },
})(
  async function getExpressRoutes({ app_name }) {
    const app = resolveApp(app_name);
    if (!app) {
      return { error: expressApps.size === 0 ? 'No Express apps registered' : `App "${app_name}" not found` };
    }

    const router = app._router || app.router;
    if (!router || !router.stack) {
      return { error: 'Express app has no _router or router.stack (app may not have any routes defined)' };
    }

    const routes = [];
    walkExpressStack(router.stack, '', routes, []);

    return {
      framework: 'express',
      route_count: routes.filter(r => r.type === 'route').length,
      routes,
    };
  }
);

/**
 * Recursively walk the Express router stack.
 */
function walkExpressStack(stack, basePath, routes, middlewareChain) {
  for (const layer of stack) {
    if (layer.route) {
      // This is a route definition
      const path = basePath + layer.route.path;
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      const layers = layer.route.stack || [];

      routes.push({
        type: 'route',
        path,
        methods,
        params: (layer.keys || []).map(k => k.name),
        regex: layer.regexp?.source || '',
        middleware: layers.map(l => ({
          name: l.name || 'anonymous',
          method: l.method ? l.method.toUpperCase() : undefined,
        })),
      });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      // Nested router (mounted via express.Router())
      const prefix = extractMountPath(layer, basePath);
      walkExpressStack(layer.handle.stack, prefix, routes, [...middlewareChain]);
    } else {
      // Middleware layer
      const path = extractMountPath(layer, basePath);
      routes.push({
        type: 'middleware',
        path,
        name: layer.name || 'anonymous',
        params: (layer.keys || []).map(k => k.name),
        regex: layer.regexp?.source?.slice(0, 120) || '',
      });
    }
  }
}

/**
 * Extract the mount path from a layer's regexp.
 * Express stores mounted paths in the regexp source like /^\/api\/?(?=\/|$)/i
 */
function extractMountPath(layer, basePath) {
  if (!layer.regexp || !layer.regexp.source) return basePath;

  const src = layer.regexp.source;
  // Try to extract the path from the regex
  const match = src.match(/^\/\^([^?]*?)\\\/?(?=\$|\(|\\\?)/);
  if (match) {
    let path = match[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
    return basePath + '/' + path.replace(/^\//, '');
  }

  // Fallback: if the regexp is just /^\/.*$/i it's a catch-all mounted at root
  if (src === '^\\\/?$' || src === '^\\\/?(?=\\\/|$)') {
    return basePath;
  }

  return basePath;
}

// ── get_express_middleware ────────────────────────────────────────
debugTool('get_express_middleware', 'List all middleware from registered Express apps (path, function name, type). Distinguishes app-level, router-level, and error-handling middleware.', {
  app_name: { type: 'string', description: 'Name of the registered Express app to inspect. If omitted, uses the default.', required: false },
})(
  async function getExpressMiddleware({ app_name }) {
    const app = resolveApp(app_name);
    if (!app) {
      return { error: expressApps.size === 0 ? 'No Express apps registered' : `App "${app_name}" not found` };
    }

    const router = app._router || app.router;
    if (!router || !router.stack) {
      return { error: 'Express app has no _router or router.stack' };
    }

    const middlewares = [];

    for (const layer of router.stack) {
      if (layer.route) continue; // Skip route definitions

      if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        // Nested router: walk its stack
        for (const subLayer of layer.handle.stack) {
          if (subLayer.route) continue;
          middlewares.push(describeMiddlewareLayer(subLayer, 'router-level'));
        }
      } else {
        const isErrorHandler = layer.handle && layer.handle.length === 4;
        middlewares.push(describeMiddlewareLayer(layer, isErrorHandler ? 'error-handler' : 'app-level'));
      }
    }

    return {
      framework: 'express',
      middleware_count: middlewares.length,
      middlewares,
    };
  }
);

function describeMiddlewareLayer(layer, type) {
  return {
    name: layer.name || 'anonymous',
    type,
    path: layer.path || '',
    params: (layer.keys || []).map(k => k.name),
    regex: layer.regexp?.source?.slice(0, 120) || '',
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function resolveApp(name) {
  if (name) return expressApps.get(name);
  if (_defaultApp) return _defaultApp;
  for (const [, app] of expressApps) return app;
  return null;
}

// Also try to auto-discover Express apps from require.cache
function autoDiscoverExpressApps() {
  const express = safeRequire('express');
  if (!express) return [];

  const found = [];
  for (const [id, mod] of Object.entries(require.cache)) {
    const exp = mod.exports;
    if (exp && typeof exp === 'function' && exp._router && exp._router.stack) {
      if (![...expressApps.values()].includes(exp)) {
        found.push({ id, app: exp });
      }
    }
  }
  return found;
}

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}

module.exports = { registerExpressApp, setExpressApp, expressApps };
