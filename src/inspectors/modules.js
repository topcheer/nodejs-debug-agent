'use strict';

const path = require('path');
const { debugTool } = require('../tool-registry');

// get_loaded_modules — list all loaded modules from require.cache with full paths
debugTool('get_loaded_modules', 'List all loaded Node.js modules from require.cache with full file paths', {
  prefix: { type: 'string', description: 'Filter by module path prefix (e.g., "express", "pg")', required: false },
  limit: { type: 'integer', description: 'Max number of modules to return (default 200)', required: false },
})(
  async function getLoadedModules({ prefix, limit }) {
    let entries = Object.keys(require.cache).map(id => {
      const parts = id.split(path.sep);
      return {
        path: id,
        short_name: parts.slice(-2).join('/'),
      };
    });

    if (prefix) {
      const lower = prefix.toLowerCase();
      entries = entries.filter(e =>
        e.path.toLowerCase().includes(lower) || e.short_name.toLowerCase().includes(lower)
      );
    }

    entries.sort((a, b) => a.short_name.localeCompare(b.short_name));

    const max = limit || 200;
    const total = entries.length;
    const truncated = total > max;
    if (truncated) entries = entries.slice(0, max);

    return { total, truncated, modules: entries };
  }
);

// get_module_count — count of loaded modules
debugTool('get_module_count', 'Get the count of all loaded modules in require.cache', {})(
  async function getModuleCount() {
    const cache = Object.keys(require.cache);
    // Group by top-level package
    const byPackage = {};
    for (const id of cache) {
      const nmIdx = id.indexOf(`${path.sep}node_modules${path.sep}`);
      if (nmIdx >= 0) {
        const afterNm = id.substring(nmIdx + 14);
        const parts = afterNm.split(path.sep);
        const pkgName = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
        byPackage[pkgName] = (byPackage[pkgName] || 0) + 1;
      } else {
        byPackage['[app modules]'] = (byPackage['[app modules]'] || 0) + 1;
      }
    }

    const sorted = Object.entries(byPackage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .reduce((o, [k, v]) => ({ ...o, [k]: v }), {});

    return {
      total_loaded_modules: cache.length,
      by_package_top_30: sorted,
    };
  }
);
