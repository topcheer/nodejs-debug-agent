'use strict';

const { debugTool } = require('../tool-registry');

/**
 * Detect prom-client from require.cache.
 */
function getPromClient() {
  try {
    for (const [filePath, mod] of Object.entries(require.cache)) {
      if (filePath.includes('prom-client') && mod.exports) {
        const exp = mod.exports;
        // prom-client exposes a register, Counter, Gauge, Histogram etc.
        if (exp.register || (exp.default && exp.default.register)) {
          return exp.register || (exp.default && exp.default.register);
        }
      }
    }
  } catch (e) {}

  // Also try a direct require
  try {
    const promClient = require('prom-client');
    if (promClient.register) return promClient.register;
  } catch (e) {}

  return null;
}

/**
 * Extract metric value(s) from a metric object.
 */
function getMetricValue(metric) {
  try {
    const values = [];
    // prom-client v14+: metric.get() returns { values: [{ value, labels }] }
    if (typeof metric.get === 'function') {
      const result = metric.get();
      if (result && Array.isArray(result.values)) {
        for (const v of result.values) {
          values.push({
            value: v.value,
            labels: v.labels || {},
          });
        }
      }
      return values.length > 0 ? values : [{ value: undefined }];
    }
    return [{ value: 'unable to read' }];
  } catch (e) {
    return [{ error: e.message }];
  }
}

/**
 * Build metric info from a metric object.
 */
function buildMetricInfo(metric) {
  const info = {
    name: metric.name || metric.help ? metric.name : 'unknown',
    type: metric.type || 'unknown',
    help: metric.help || '',
  };

  try {
    info.values = getMetricValue(metric);
  } catch (e) {
    info.error = e.message;
  }

  return info;
}

// get_registered_metrics — list registered Prometheus metrics
debugTool('get_registered_metrics', 'List registered Prometheus metrics from prom-client (if loaded). Shows name, type, help, and value.', {
  type: { type: 'string', description: 'Filter by metric type (counter, gauge, histogram, summary)', required: false },
})(
  async function getRegisteredMetrics({ type }) {
    const register = getPromClient();
    if (!register) {
      return {
        available: false,
        message: 'prom-client not detected. Install and require prom-client to use this tool.',
        metrics: [],
      };
    }

    try {
      let metrics = [];

      // prom-client v14+: getMetricsAsArray()
      if (typeof register.getMetricsAsArray === 'function') {
        metrics = register.getMetricsAsArray();
      }
      // prom-client v13: metrics()
      else if (typeof register.getMetrics === 'function') {
        const text = register.getMetrics();
        return {
          available: true,
          raw_output: text,
          note: 'Using getMetrics() text output (older prom-client version)',
        };
      }

      // Filter by type if requested
      if (type) {
        metrics = metrics.filter(m => m.type === type);
      }

      const result = metrics.map(buildMetricInfo);

      return {
        available: true,
        metric_count: result.length,
        metrics: result,
      };
    } catch (e) {
      return { error: e.message };
    }
  }
);

// get_metric_value — get specific metric value by name
debugTool('get_metric_value', 'Get the value of a specific registered Prometheus metric by name', {
  metric_name: { type: 'string', description: 'Name of the metric to retrieve', required: true },
})(
  async function getMetricValue({ metric_name }) {
    const register = getPromClient();
    if (!register) {
      return {
        available: false,
        message: 'prom-client not detected. Install and require prom-client to use this tool.',
      };
    }

    try {
      let metrics = [];

      if (typeof register.getMetricsAsArray === 'function') {
        metrics = register.getMetricsAsArray();
      } else if (typeof register._metrics === 'object') {
        // Fallback: access internal metrics map
        metrics = Object.values(register._metrics);
      }

      const metric = metrics.find(m => m.name === metric_name);
      if (!metric) {
        return {
          found: false,
          error: `No metric found with name: ${metric_name}`,
          available_metrics: metrics.map(m => m.name).filter(Boolean),
        };
      }

      const info = buildMetricInfo(metric);
      info.found = true;
      return info;
    } catch (e) {
      return { error: e.message };
    }
  }
);
