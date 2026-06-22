'use strict';

const path = require('path');
const { debugTool, registry } = require('../tool-registry');

/**
 * Map tool names to their originating inspector file.
 * Uses a heuristic: tool names follow domain naming conventions.
 */
function buildToolGrouping() {
  const allTools = registry.allSchemas();
  const allNames = registry.names();

  // Known inspector module → tool name prefix mapping
  // Build reverse: each tool → group
  const inspectorFiles = [
    { file: 'runtime.js', labels: ['heap', 'gc', 'system', 'v8'] },
    { file: 'framework.js', labels: ['framework'] },
    { file: 'http-tracker.js', labels: ['http'] },
    { file: 'system.js', labels: ['cpu_info', 'disk', 'uptime'] },
    { file: 'active-handles.js', labels: ['handle', 'request', 'active'] },
    { file: 'v8-heap.js', labels: ['heap_snapshot', 'heap_space', 'heap_code'] },
    { file: 'modules.js', labels: ['module', 'loaded_module'] },
    { file: 'process.js', labels: ['process_info', 'event_loop', 'resource_usage'] },
    { file: 'database.js', labels: ['db', 'database', 'pool'] },
    { file: 'redis.js', labels: ['redis'] },
    { file: 'express.js', labels: ['express'] },
    { file: 'fastify.js', labels: ['fastify'] },
    { file: 'mongoose.js', labels: ['mongo', 'mongoose'] },
    { file: 'bullmq.js', labels: ['bull', 'queue', 'job'] },
    { file: 'cluster.js', labels: ['cluster', 'worker'] },
    { file: 'logging.js', labels: ['log'] },
    { file: 'cache.js', labels: ['cache'] },
    { file: 'http-client.js', labels: ['http_client', 'outbound'] },
    { file: 'fd.js', labels: ['fd', 'file_descriptor'] },
    { file: 'metrics.js', labels: ['metric'] },
    { file: 'perf.js', labels: ['perf'] },
    { file: 'sockets.js', labels: ['socket'] },
    { file: 'streams.js', labels: ['stream'] },
    { file: 'security.js', labels: ['security', 'env_secret', 'header'] },
    { file: 'health.js', labels: ['health', 'readiness', 'liveness'] },
    { file: 'scheduler.js', labels: ['cron', 'schedule', 'timer'] },
    { file: 'error-tracking.js', labels: ['error'] },
    { file: 'websocket.js', labels: ['websocket', 'ws_'] },
    { file: 'locks.js', labels: ['lock', 'mutex', 'semaphore'] },
    { file: 'migrations.js', labels: ['migration'] },
    { file: 'config.js', labels: ['config'] },
    { file: 'feature-flags.js', labels: ['feature', 'flag'] },
    { file: 'endpoint-test.js', labels: ['endpoint', 'test_endpoint'] },
    { file: 'pool.js', labels: ['pool'] },
    { file: 'cpu-profile.js', labels: ['cpu_profile', 'top_function'] },
    { file: 'leak-detector.js', labels: ['heap_snapshot', 'leak'] },
    { file: 'build-info.js', labels: ['build', 'deployment', 'runtime_version'] },
    { file: 'snapshot.js', labels: ['snapshot'] },
    { file: 'service-registry.js', labels: ['registered_service', 'service_dependency'] },
  ];

  const groups = {};
  const matched = new Set();

  for (const { file, labels } of inspectorFiles) {
    const tools = [];
    for (const name of allNames) {
      if (matched.has(name)) continue;
      const lower = name.toLowerCase();
      // Check if any label matches
      for (const label of labels) {
        if (lower.includes(label.toLowerCase())) {
          const tool = registry.get(name);
          tools.push({
            name,
            description: tool.description,
          });
          matched.add(name);
          break;
        }
      }
    }
    if (tools.length > 0) {
      groups[file] = tools;
    }
  }

  // Collect unmatched tools
  const unmatched = [];
  for (const name of allNames) {
    if (!matched.has(name)) {
      const tool = registry.get(name);
      unmatched.push({
        name,
        description: tool.description,
      });
    }
  }
  if (unmatched.length > 0) {
    groups['[unmatched]'] = unmatched;
  }

  return groups;
}

/**
 * get_registered_services — List all registered debug agent tools grouped by inspector.
 */
debugTool('get_registered_services', 'List all registered debug agent tools grouped by inspector file, showing tool count and names. Provides the full capability map.', {})(
  async function getRegisteredServices() {
    const groups = buildToolGrouping();
    const allNames = registry.names();

    const result = [];
    for (const [file, tools] of Object.entries(groups)) {
      result.push({
        inspector: file,
        tool_count: tools.length,
        tools: tools.map(t => ({ name: t.name, description: t.description })),
      });
    }

    return {
      total_tools: allNames.length,
      inspector_count: result.length,
      inspectors: result,
    };
  }
);

/**
 * get_service_dependencies — Show loaded project modules from require.cache.
 */
debugTool('service_dependencies', 'Show loaded modules from require.cache filtered to project modules (excludes node_modules internals). Useful for understanding the dependency graph.', {
  include_node_modules: { type: 'boolean', description: 'Include node_modules packages (default false, only project modules)', required: false },
  limit: { type: 'integer', description: 'Max results to return (default 100)', required: false },
})(
  async function getServiceDependencies({ include_node_modules, limit }) {
    const max = limit || 100;
    const includeNM = include_node_modules || false;

    const projectModules = [];
    const nmPackages = {};

    for (const id of Object.keys(require.cache)) {
      const sep = path.sep;
      const nmIdx = id.indexOf(`${sep}node_modules${sep}`);

      if (nmIdx >= 0) {
        if (!includeNM) continue;
        // Extract package name
        const afterNm = id.substring(nmIdx + 14); // length of /node_modules/
        const parts = afterNm.split(sep);
        const pkgName = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
        nmPackages[pkgName] = (nmPackages[pkgName] || 0) + 1;
      } else {
        // Project module
        const relPath = path.relative(process.cwd(), id);
        projectModules.push({
          path: id,
          relative_path: relPath,
        });
      }
    }

    const result = {
      project_module_count: projectModules.length,
      project_modules: projectModules.slice(0, max),
    };

    if (includeNM) {
      const sortedPkgs = Object.entries(nmPackages)
        .sort((a, b) => b[1] - a[1]);
      result.node_modules_package_count = sortedPkgs.length;
      result.node_modules_packages = sortedPkgs
        .slice(0, max)
        .map(([name, count]) => ({ package: name, loaded_files: count }));
    }

    return result;
  }
);
