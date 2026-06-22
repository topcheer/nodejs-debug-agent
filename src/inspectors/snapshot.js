'use strict';

const v8 = require('v8');
const os = require('os');
const path = require('path');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { debugTool, registry } = require('../tool-registry');

// --- Stored snapshots ---
const snapshots = new Map();
let snapshotCounter = 0;

// --- GC tracking state ---
let gcCount = 0;
let gcObserver = null;

function initGcTracking() {
  try {
    gcObserver = new (require('perf_hooks').PerformanceObserver)((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'gc') {
          gcCount++;
        }
      }
    });
    gcObserver.observe({ entryTypes: ['gc'] });
  } catch (e) {
    // PerformanceObserver or gc entry type may not be available
  }
}

initGcTracking();

/**
 * Collect metrics across all inspector domains.
 */
async function collectMetrics() {
  const metrics = {};

  // Process / memory
  const mem = process.memoryUsage();
  metrics.memory = {
    rss: mem.rss,
    heap_total: mem.heapTotal,
    heap_used: mem.heapUsed,
    external: mem.external,
    array_buffers: mem.arrayBuffers,
  };

  // CPU usage
  try {
    const cpu = process.cpuUsage();
    metrics.cpu = {
      user_us: cpu.user,
      system_us: cpu.system,
    };
  } catch (e) {}

  // Active handles / requests
  try {
    metrics.handles = process._getActiveHandles().length;
    metrics.requests = process._getActiveRequests().length;
  } catch (e) {}

  // GC count
  metrics.gc_count = gcCount;

  // V8 heap stats
  try {
    const heapStats = v8.getHeapStatistics();
    metrics.v8_heap = {
      total_heap_size: heapStats.total_heap_size,
      used_heap_size: heapStats.used_heap_size,
      malloced_memory: heapStats.malloced_memory,
      number_of_native_contexts: heapStats.number_of_native_contexts,
      number_of_detached_contexts: heapStats.number_of_detached_contexts,
    };
  } catch (e) {}

  // Event loop lag (quick measurement)
  try {
    const lag = await new Promise(resolve => {
      const start = performance.now();
      setImmediate(() => resolve(performance.now() - start));
    });
    metrics.event_loop_lag_ms = parseFloat(lag.toFixed(2));
  } catch (e) {}

  // Loaded module count
  try {
    metrics.loaded_modules = Object.keys(require.cache).length;
  } catch (e) {}

  // System info
  try {
    metrics.system = {
      free_mem: os.freemem(),
      load_avg_1: os.loadavg()[0],
      load_avg_5: os.loadavg()[1],
      load_avg_15: os.loadavg()[2],
    };
  } catch (e) {}

  // Process uptime
  metrics.uptime_seconds = process.uptime();

  // HTTP request count (from http-tracker if available)
  try {
    const httpTracker = registry.get('get_http_stats');
    if (httpTracker) {
      const httpStats = await httpTracker.func({});
      if (httpStats && !httpStats.error) {
        metrics.http = httpStats;
      }
    }
  } catch (e) {}

  // DB pool stats (from database inspector)
  try {
    const dbTool = registry.get('get_db_pool_status');
    if (dbTool) {
      const dbStats = await dbTool.func({});
      if (dbStats && !dbStats.error) {
        metrics.db_pools = dbStats;
      }
    }
  } catch (e) {}

  // Cache stats (from cache inspector)
  try {
    const cacheTool = registry.get('get_cache_stats');
    if (cacheTool) {
      const cacheStats = await cacheTool.func({});
      if (cacheStats && !cacheStats.error) {
        metrics.caches = cacheStats;
      }
    }
  } catch (e) {}

  // Error count (from error-tracking inspector)
  try {
    const errorTool = registry.get('get_error_log');
    if (errorTool) {
      const errorStats = await errorTool.func({});
      if (errorStats && !errorStats.error) {
        metrics.errors = {
          count: errorStats.total_errors || (errorStats.errors ? errorStats.errors.length : 0),
        };
      }
    }
  } catch (e) {}

  return metrics;
}

/**
 * take_snapshot — Collect metrics across ALL inspectors.
 */
debugTool('take_snapshot', 'Collect a comprehensive metrics snapshot across all inspectors: event loop lag, heap used, GC count, active handles/requests, CPU usage, HTTP request count, DB pool stats, error count, cache stats, and more. Returns snapshot ID and summary.', {})(
  async function takeSnapshot() {
    const metrics = await collectMetrics();

    snapshotCounter++;
    const id = `snap-${snapshotCounter}`;

    const entry = {
      id,
      timestamp: new Date().toISOString(),
      metrics,
    };

    snapshots.set(id, entry);

    // Build summary
    const toMB = v => parseFloat((v / 1024 / 1024).toFixed(2));

    return {
      snapshot_id: id,
      timestamp: entry.timestamp,
      summary: {
        event_loop_lag_ms: metrics.event_loop_lag_ms,
        heap_used_mb: metrics.memory ? toMB(metrics.memory.heap_used) : null,
        rss_mb: metrics.memory ? toMB(metrics.memory.rss) : null,
        gc_count: metrics.gc_count,
        active_handles: metrics.handles,
        active_requests: metrics.requests,
        cpu_user_ms: metrics.cpu ? Math.round(metrics.cpu.user_us / 1000) : null,
        cpu_system_ms: metrics.cpu ? Math.round(metrics.cpu.system_us / 1000) : null,
        loaded_modules: metrics.loaded_modules,
        uptime_seconds: Math.round(metrics.uptime_seconds),
        http_stats: metrics.http ? 'available' : 'not_available',
        db_pools: metrics.db_pools ? 'available' : 'not_available',
        caches: metrics.caches ? 'available' : 'not_available',
        errors: metrics.errors ? metrics.errors.count : 0,
      },
      total_snapshots: snapshots.size,
    };
  }
);

/**
 * Helper to flatten metrics for comparison.
 */
function flattenMetrics(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenMetrics(value, fullKey));
    } else if (typeof value === 'number') {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * compare_snapshots — Compare two snapshots.
 */
debugTool('compare_snapshots', 'Compare two metric snapshots by ID. Returns all changed numeric values with delta and percentage change.', {
  snapshot_id_1: { type: 'string', description: 'First (earlier) snapshot ID', required: true },
  snapshot_id_2: { type: 'string', description: 'Second (later) snapshot ID', required: true },
})(
  async function compareSnapshots({ snapshot_id_1, snapshot_id_2 }) {
    const snap1 = snapshots.get(snapshot_id_1);
    const snap2 = snapshots.get(snapshot_id_2);

    if (!snap1) return { error: `Snapshot not found: ${snapshot_id_1}` };
    if (!snap2) return { error: `Snapshot not found: ${snapshot_id_2}` };

    const flat1 = flattenMetrics(snap1.metrics);
    const flat2 = flattenMetrics(snap2.metrics);

    const allKeys = new Set([...Object.keys(flat1), ...Object.keys(flat2)]);
    const changes = [];

    for (const key of allKeys) {
      const v1 = flat1[key];
      const v2 = flat2[key];

      if (v1 === undefined || v2 === undefined) continue;

      const delta = v2 - v1;
      const pct = v1 !== 0 ? parseFloat(((delta / Math.abs(v1)) * 100).toFixed(2)) : null;

      changes.push({
        metric: key,
        value_1: v1,
        value_2: v2,
        delta: parseFloat(delta.toFixed(4)),
        percentage: pct,
      });
    }

    changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const changed = changes.filter(c => c.delta !== 0);
    const unchanged = changes.filter(c => c.delta === 0);

    return {
      snapshot_1: snap1.id,
      snapshot_2: snap2.id,
      timestamp_1: snap1.timestamp,
      timestamp_2: snap2.timestamp,
      total_metrics: changes.length,
      changed_count: changed.length,
      unchanged_count: unchanged.length,
      changes: changed.slice(0, 50),
    };
  }
);

/**
 * list_snapshots — List all stored snapshots.
 */
debugTool('list_snapshots', 'List all stored metric snapshots with ID, timestamp, and key summary values', {})(
  async function listSnapshots() {
    const list = [];
    for (const [id, snap] of snapshots) {
      const m = snap.metrics;
      const toMB = v => parseFloat((v / 1024 / 1024).toFixed(2));
      list.push({
        id,
        timestamp: snap.timestamp,
        event_loop_lag_ms: m.event_loop_lag_ms,
        heap_used_mb: m.memory ? toMB(m.memory.heap_used) : null,
        rss_mb: m.memory ? toMB(m.memory.rss) : null,
        gc_count: m.gc_count,
        active_handles: m.handles,
        active_requests: m.requests,
        uptime_seconds: m.uptime_seconds ? Math.round(m.uptime_seconds) : null,
      });
    }
    return {
      total_snapshots: list.length,
      snapshots: list,
    };
  }
);
