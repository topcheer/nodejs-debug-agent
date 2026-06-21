'use strict';

const { debugTool } = require('../tool-registry');

// get_routes — introspect Express routes
debugTool('get_routes', 'List all registered Express routes with methods and paths', {})(
  async function getRoutes() {
    const express = safeRequire('express');
    if (!express) return { error: 'Express is not installed' };

    const routes = [];
    // Walk loaded modules to find Express apps
    for (const [name, mod] of Object.entries(require.cache)) {
      if (mod.exports && typeof mod.exports === 'function' && mod.exports._router) {
        // It's likely an Express app
        walkRouter(mod.exports._router, '', routes);
      }
      if (mod.exports && mod.exports.router && mod.exports.router.stack) {
        walkRouter(mod.exports.router, '', routes);
      }
    }
    return { framework: 'express', route_count: routes.length, routes };
  }
);

function walkRouter(router, basePath, routes) {
  if (!router.stack) return;
  for (const layer of router.stack) {
    if (layer.route) {
      const path = basePath + layer.route.path;
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      routes.push({ path, methods, name: layer.route.path });
    } else if (layer.name === 'router' && layer.handle.stack) {
      let prefix = basePath;
      if (layer.regexp && layer.regexp.source) {
        const match = layer.regexp.source.match(/^\/\^([^?]+)/);
        if (match) prefix = basePath + match[1].replace(/\\/g, '');
      }
      walkRouter(layer.handle, prefix, routes);
    }
  }
}

// get_middleware — list middleware stack
debugTool('get_middleware', 'List Express middleware stack', {})(
  async function getMiddleware() {
    const express = safeRequire('express');
    if (!express) return { error: 'Express is not installed' };

    const middlewares = [];
    for (const [name, mod] of Object.entries(require.cache)) {
      if (mod.exports && typeof mod.exports === 'function' && mod.exports._router) {
        for (const layer of mod.exports._router.stack) {
          if (!layer.route) {
            middlewares.push({
              name: layer.name,
              params: layer.keys?.length || 0,
              regexp: layer.regexp?.source?.slice(0, 80) || '',
            });
          }
        }
      }
    }
    return { middleware_count: middlewares.length, middlewares };
  }
);

// get_installed_packages
debugTool('get_installed_packages', 'List installed npm packages from package.json', {
  prefix: { type: 'string', description: 'Filter by name prefix', required: false },
})(
  async function getInstalledPackages({ prefix }) {
    const path = require('path');
    const fs = require('fs');
    let packages = [];

    // Read from node_modules
    const cwd = process.cwd();
    const nmPath = path.join(cwd, 'node_modules');

    try {
      if (fs.existsSync(nmPath)) {
        const entries = fs.readdirSync(nmPath);
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          if (entry.startsWith('@')) {
            const scopedPath = path.join(nmPath, entry);
            for (const scoped of fs.readdirSync(scopedPath)) {
              const pkgJsonPath = path.join(scopedPath, scoped, 'package.json');
              if (fs.existsSync(pkgJsonPath)) {
                try {
                  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                  packages.push({ name: `${entry}/${scoped}`, version: pkg.version });
                } catch (e) {}
              }
            }
          } else {
            const pkgJsonPath = path.join(nmPath, entry, 'package.json');
            if (fs.existsSync(pkgJsonPath)) {
              try {
                const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                packages.push({ name: entry, version: pkg.version });
              } catch (e) {}
            }
          }
        }
      }
    } catch (e) {
      return { error: e.message };
    }

    if (prefix) {
      packages = packages.filter(p => p.name.toLowerCase().includes(prefix.toLowerCase()));
    }
    packages.sort((a, b) => a.name.localeCompare(b.name));

    return { total: packages.length, packages };
  }
);

// get_environment_variables
debugTool('get_environment_variables', 'List environment variables (potential secrets masked)', {
  prefix: { type: 'string', description: 'Filter by prefix', required: false },
})(
  async function getEnvironmentVariables({ prefix }) {
    let env = { ...process.env };
    if (prefix) {
      const filtered = {};
      for (const [k, v] of Object.entries(env)) {
        if (k.toUpperCase().startsWith(prefix.toUpperCase())) filtered[k] = v;
      }
      env = filtered;
    }
    const masked = {};
    const secretPatterns = ['KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL'];
    for (const [k, v] of Object.entries(env)) {
      if (secretPatterns.some(s => k.toUpperCase().includes(s))) {
        masked[k] = '***masked***';
      } else {
        masked[k] = v;
      }
    }
    return { variables: masked, count: Object.keys(masked).length };
  }
);

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}
