'use strict';

const { debugTool } = require('../tool-registry');

// Registry of health checks
const healthChecks = new Map();

/**
 * Register a custom health check at runtime.
 * @param {string} name - Identifier for this health check (e.g. 'database', 'redis')
 * @param {function} fn - Async function returning { status: 'up'|'down', detail?: any }
 */
function registerHealthCheck(name, fn) {
  healthChecks.set(name, fn);
}

// ── get_health_status ─────────────────────────────────────────────
debugTool('get_health_status', 'Run all registered health checks and return aggregate status (UP/DOWN per component). Reports overall status and individual component health.', {})(
  async function getHealthStatus() {
    if (healthChecks.size === 0) {
      return { status: 'No health checks registered. Call registerHealthCheck(name, fn) first.' };
    }

    const components = [];
    let overallUp = true;

    for (const [name, checkFn] of healthChecks) {
      const start = Date.now();
      try {
        const result = await checkFn();
        const elapsed = Date.now() - start;
        const isUp = result?.status === 'up' || result?.status === 'UP';
        if (!isUp) overallUp = false;

        components.push({
          name,
          status: isUp ? 'UP' : 'DOWN',
          response_time_ms: elapsed,
          detail: result?.detail || undefined,
        });
      } catch (e) {
        overallUp = false;
        components.push({
          name,
          status: 'DOWN',
          response_time_ms: Date.now() - start,
          error: e.message,
        });
      }
    }

    return {
      overall_status: overallUp ? 'UP' : 'DOWN',
      component_count: components.length,
      up_count: components.filter(c => c.status === 'UP').length,
      down_count: components.filter(c => c.status === 'DOWN').length,
      components,
    };
  }
);

// ── get_health_detail ─────────────────────────────────────────────
debugTool('get_health_detail', 'Run a specific health check by component name and return detailed status information.', {
  component_name: { type: 'string', description: 'Name of the registered health check component to run' },
})(
  async function getHealthDetail({ component_name }) {
    if (!component_name) {
      return { error: 'component_name is required. Registered checks: ' + (healthChecks.size > 0 ? [...healthChecks.keys()].join(', ') : 'none') };
    }

    const checkFn = healthChecks.get(component_name);
    if (!checkFn) {
      return {
        error: `Health check "${component_name}" not found`,
        registered_checks: healthChecks.size > 0 ? [...healthChecks.keys()] : [],
      };
    }

    const start = Date.now();
    try {
      const result = await checkFn();
      const elapsed = Date.now() - start;
      const isUp = result?.status === 'up' || result?.status === 'UP';

      return {
        component: component_name,
        status: isUp ? 'UP' : 'DOWN',
        response_time_ms: elapsed,
        detail: result?.detail || result,
        timestamp: new Date().toISOString(),
      };
    } catch (e) {
      return {
        component: component_name,
        status: 'DOWN',
        response_time_ms: Date.now() - start,
        error: e.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
);

// ── register_health_check ─────────────────────────────────────────
debugTool('register_health_check', 'Register a custom health check at runtime. The check function should return { status: "up"|"down", detail?: any }. NOTE: This tool registers a health check identified by its name; call get_health_status to execute it.', {
  name: { type: 'string', description: 'Identifier for this health check' },
  description: { type: 'string', description: 'Human-readable description of what this check does', required: false },
})(
  async function registerHealthCheckTool({ name, description }) {
    if (!name) {
      return { error: 'name is required' };
    }

    // Register a placeholder check that the app can later replace with a real function.
    // In practice, apps call registerHealthCheck(name, fn) from code.
    if (!healthChecks.has(name)) {
      registerHealthCheck(name, async () => ({
        status: 'up',
        detail: description || 'Health check registered at runtime (placeholder)',
      }));
    }

    return {
      status: 'registered',
      name,
      description: description || null,
      total_checks: healthChecks.size,
      all_checks: [...healthChecks.keys()],
    };
  }
);

module.exports = { registerHealthCheck, healthChecks };
