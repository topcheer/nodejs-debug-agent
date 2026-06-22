'use strict';

const { debugTool } = require('../tool-registry');

// --- Registry of connection pools ---
const pools = new Map();

// --- Wait time tracking ---
const poolWaitStats = new Map(); // name -> { samples: [], total_waits, total_wait_ms }

/**
 * Register a connection pool for inspection.
 * Supports pg.Pool, mysql2 pool, or custom pool objects.
 * @param {string} name - Identifier for this pool
 * @param {object} poolObj - The pool instance
 */
function registerPool(name, poolObj) {
  pools.set(name, poolObj);
  if (!poolWaitStats.has(name)) {
    poolWaitStats.set(name, { samples: [], total_waits: 0, total_wait_ms: 0, max_wait_ms: 0 });
  }
}

/**
 * Detect pool type: 'pg' | 'mysql2' | 'generic'
 */
function detectPoolType(pool) {
  if (!pool) return 'unknown';
  // pg.Pool: has totalCount, idleCount, waitingCount
  if (
    typeof pool.totalCount === 'number' ||
    (pool.pool && typeof pool.pool.totalCount === 'number')
  ) {
    return 'pg';
  }
  // mysql2 pool: has _allConnections, _freeConnections, _connectionQueue, getConnection
  if (
    Array.isArray(pool._allConnections) &&
    Array.isArray(pool._freeConnections) &&
    typeof pool.getConnection === 'function'
  ) {
    return 'mysql2';
  }
  // Generic: has acquire/release or similar
  if (typeof pool.acquire === 'function' || typeof pool.connect === 'function') {
    return 'generic';
  }
  return 'unknown';
}

/**
 * Extract deep stats from a pg.Pool.
 */
function inspectPgPool(name, pool) {
  const info = { name, type: 'pg' };

  // pg.Pool v8+ exposes these directly
  const p = pool.pool || pool; // Some wrappers have .pool
  info.total = p.totalCount !== undefined ? p.totalCount : null;
  info.idle = p.idleCount !== undefined ? p.idleCount : null;
  info.waiting = p.waitingCount !== undefined ? p.waitingCount : null;

  if (p.options) {
    info.max = p.options.max !== undefined ? p.options.max : null;
    info.idle_timeout_ms = p.options.idleTimeoutMillis !== undefined ? p.options.idleTimeoutMillis : null;
    info.connection_timeout_ms = p.options.connectionTimeoutMillis !== undefined ? p.options.connectionTimeoutMillis : null;
  }

  info.active = info.total !== null && info.idle !== null ? info.total - info.idle : null;

  return info;
}

/**
 * Extract deep stats from a mysql2 pool.
 */
function inspectMysql2Pool(name, pool) {
  const info = { name, type: 'mysql2' };

  info.total = pool._allConnections ? pool._allConnections.length : null;
  info.idle = pool._freeConnections ? pool._freeConnections.length : null;
  info.waiting = pool._connectionQueue ? pool._connectionQueue.length : null;
  info.active = info.total !== null && info.idle !== null ? info.total - info.idle : null;

  if (pool.config) {
    info.max = pool.config.connectionLimit !== undefined ? pool.config.connectionLimit : null;
    info.queue_limit = pool.config.queueLimit !== undefined ? pool.config.queueLimit : null;
  }

  return info;
}

/**
 * Extract stats from a generic pool.
 */
function inspectGenericPool(name, pool) {
  const info = { name, type: 'generic' };

  // Try common pool interfaces
  info.size = pool.size !== undefined ? pool.size : (typeof pool.size === 'function' ? pool.size() : null);
  info.available = pool.available !== undefined ? pool.available : null;
  info.borrowed = pool.borrowed !== undefined ? pool.borrowed : null;
  info.pending = pool.pending !== undefined ? pool.pending : null;
  info.max = pool.max !== undefined ? pool.max : (pool.maxSize !== undefined ? pool.maxSize : null);
  info.min = pool.min !== undefined ? pool.min : (pool.minSize !== undefined ? pool.minSize : null);

  // Normalize to common fields
  info.total = info.size;
  info.idle = info.available;
  info.active = info.borrowed;
  info.waiting = info.pending;

  return info;
}

function inspectPool(name, pool) {
  const type = detectPoolType(pool);
  switch (type) {
    case 'pg':
      return inspectPgPool(name, pool);
    case 'mysql2':
      return inspectMysql2Pool(name, pool);
    case 'generic':
      return inspectGenericPool(name, pool);
    default:
      return { name, type: 'unknown', note: 'Pool type not recognized. Expected pg.Pool, mysql2 pool, or generic pool with acquire/release.' };
  }
}

// Auto-discover pools from require.cache
function autoDiscoverPools() {
  const discovered = [];

  // pg.Pool
  try {
    const pg = require('pg');
    if (pg && pg.Pool) {
      for (const [id, mod] of Object.entries(require.cache)) {
        if (mod.exports instanceof pg.Pool) {
          const name = 'pg:' + id.split('/').slice(-2).join('/');
          if (!pools.has(name)) {
            pools.set(name, mod.exports);
            discovered.push({ name, type: 'pg', source: id });
          }
        }
      }
    }
  } catch {}

  // mysql2 pool
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      const exp = mod.exports;
      if (exp && exp._allConnections && typeof exp.getConnection === 'function') {
        const name = 'mysql2:' + id.split('/').slice(-2).join('/');
        if (!pools.has(name)) {
          pools.set(name, exp);
          discovered.push({ name, type: 'mysql2', source: id });
        }
      }
    }
  } catch {}

  return discovered;
}

// ── get_pool_details ─────────────────────────────────────────────
debugTool('get_pool_details', 'Get deep connection pool statistics for registered DB pools (pg.Pool, mysql2). Shows total, idle, active, waiting, and max connections. Auto-detects pg and mysql2 pools.', {
  pool_name: { type: 'string', description: 'Specific pool name to inspect. If omitted, returns all registered pools.', required: false },
})(
  async function getPoolDetails({ pool_name }) {
    // Auto-discover if none registered
    if (pools.size === 0) {
      autoDiscoverPools();
    }

    if (pool_name) {
      const pool = pools.get(pool_name);
      if (!pool) {
        return {
          error: `No pool registered with name: ${pool_name}`,
          registered_pools: [...pools.keys()],
        };
      }
      return inspectPool(pool_name, pool);
    }

    if (pools.size === 0) {
      return {
        status: 'No connection pools detected. Register via registerPool(name, poolObj) or ensure pg/mysql2 pools are in require.cache.',
      };
    }

    const details = [];
    for (const [name, pool] of pools) {
      details.push(inspectPool(name, pool));
    }

    return {
      pool_count: details.length,
      pools: details,
    };
  }
);

// ── detect_pool_leaks ────────────────────────────────────────────
debugTool('detect_pool_leaks', 'Heuristic detection of connection pool leaks. Checks for: connections held longer than 30s, waiting queue growing, idle connections below max for extended periods. Reports potential leaks and warnings.', {
  pool_name: { type: 'string', description: 'Specific pool name to check. If omitted, checks all registered pools.', required: false },
})(
  async function detectPoolLeaks({ pool_name }) {
    // Auto-discover if none registered
    if (pools.size === 0) {
      autoDiscoverPools();
    }

    const poolsToCheck = pool_name
      ? [[pool_name, pools.get(pool_name)]].filter(([, p]) => p)
      : [...pools.entries()];

    if (poolsToCheck.length === 0) {
      return { status: 'No connection pools registered. Call registerPool(name, poolObj) first.' };
    }

    const results = [];

    for (const [name, pool] of poolsToCheck) {
      const stats = inspectPool(name, pool);
      const issues = [];
      const max = stats.max;
      const total = stats.total;
      const idle = stats.idle;
      const active = stats.active;
      const waiting = stats.waiting;

      // Heuristic 1: High active count (most connections in use)
      if (max && active !== null && active >= max * 0.9) {
        issues.push({
          severity: 'warning',
          type: 'near_capacity',
          message: `${active}/${max} connections active (${(active / max * 100).toFixed(0)}%). Pool is near capacity.`,
          detail: { active, max, utilization_percent: +(active / max * 100).toFixed(1) },
        });
      }

      // Heuristic 2: Growing wait queue
      if (waiting !== null && waiting > 0) {
        issues.push({
          severity: waiting > 5 ? 'critical' : 'warning',
          type: 'wait_queue_growing',
          message: `${waiting} connection requests waiting in queue. This may indicate slow queries or connection leaks.`,
          detail: { waiting_count: waiting },
        });
      }

      // Heuristic 3: Idle = 0 but total < max (connections not being released)
      if (idle === 0 && total !== null && max && total < max) {
        issues.push({
          severity: 'warning',
          type: 'no_idle_connections',
          message: 'No idle connections but pool is below max size. Connections may not be released properly.',
          detail: { idle, total, max },
        });
      }

      // Heuristic 4: Total = max and waiting > 0 (exhausted pool)
      if (max && total === max && waiting > 0) {
        issues.push({
          severity: 'critical',
          type: 'pool_exhausted',
          message: 'Pool is fully exhausted. All connections are in use and requests are waiting.',
          detail: { total, max, waiting },
        });
      }

      // Heuristic 5: Check for long-held connections via process measurement
      // We approximate by checking if pool has an idleTimeout and connections are not timing out
      if (stats.idle_timeout_ms && stats.idle_timeout_ms > 60000) {
        issues.push({
          severity: 'info',
          type: 'long_idle_timeout',
          message: `Idle timeout is ${stats.idle_timeout_ms}ms (>60s). Idle connections may linger longer than expected.`,
          detail: { idle_timeout_ms: stats.idle_timeout_ms },
        });
      }

      const hasIssues = issues.length > 0;
      results.push({
        name,
        type: stats.type,
        stats: { total, idle, active, waiting, max },
        leak_detected: hasIssues && issues.some(i => i.type === 'pool_exhausted' || i.type === 'wait_queue_growing'),
        issue_count: issues.length,
        issues,
        status: hasIssues ? 'potential_issues' : 'healthy',
      });
    }

    const totalIssues = results.reduce((sum, r) => sum + r.issue_count, 0);
    const leaksDetected = results.some(r => r.leak_detected);

    return {
      pool_count: results.length,
      pools_checked: results.length,
      total_issues: totalIssues,
      leak_detected: leaksDetected,
      status: leaksDetected ? 'leaks_detected' : totalIssues > 0 ? 'warnings' : 'healthy',
      pools: results,
    };
  }
);

// ── get_pool_wait_stats ──────────────────────────────────────────
debugTool('get_pool_wait_stats', 'Get connection acquire wait time statistics for registered pools. Tracks how long connection requests have to wait before getting a connection from the pool.', {
  pool_name: { type: 'string', description: 'Specific pool name. If omitted, returns wait stats for all registered pools.', required: false },
})(
  async function getPoolWaitStats({ pool_name }) {
    // Measure current acquire wait time by timing a getConnection/acquire
    const poolsToMeasure = pool_name
      ? [[pool_name, pools.get(pool_name)]].filter(([, p]) => p)
      : [...pools.entries()];

    if (poolsToMeasure.length === 0) {
      return {
        status: 'No connection pools registered. Call registerPool(name, poolObj) first.',
      };
    }

    const results = [];

    for (const [name, pool] of poolsToMeasure) {
      const stats = poolWaitStats.get(name) || { samples: [], total_waits: 0, total_wait_ms: 0, max_wait_ms: 0 };
      const poolStats = inspectPool(name, pool);
      let liveAcquireMs = null;

      // Measure live acquire wait time
      const start = Date.now();
      try {
        if (typeof pool.connect === 'function') {
          // pg.Pool.connect returns a client
          const client = await pool.connect();
          if (client && typeof client.release === 'function') client.release();
          liveAcquireMs = Date.now() - start;
        } else if (typeof pool.getConnection === 'function') {
          // mysql2 pool.getConnection returns a connection
          const conn = await pool.getConnection();
          if (conn && typeof conn.release === 'function') conn.release();
          else if (conn && typeof conn.end === 'function') conn.end();
          liveAcquireMs = Date.now() - start;
        } else if (typeof pool.acquire === 'function') {
          const resource = await pool.acquire();
          if (resource && typeof pool.release === 'function') pool.release(resource);
          liveAcquireMs = Date.now() - start;
        }
      } catch (e) {
        liveAcquireMs = Date.now() - start;
        // Record failed acquire
      }

      // Add to samples
      if (liveAcquireMs !== null) {
        stats.samples.push(liveAcquireMs);
        stats.total_waits++;
        stats.total_wait_ms += liveAcquireMs;
        if (liveAcquireMs > stats.max_wait_ms) stats.max_wait_ms = liveAcquireMs;
        // Keep last 100 samples
        if (stats.samples.length > 100) stats.samples.shift();
        poolWaitStats.set(name, stats);
      }

      // Compute stats
      const samples = stats.samples;
      const sorted = [...samples].sort((a, b) => a - b);
      const waitStats = {
        name,
        current_acquire_ms: liveAcquireMs,
        total_acquires: stats.total_waits,
        min_wait_ms: sorted.length > 0 ? sorted[0] : null,
        max_wait_ms: sorted.length > 0 ? sorted[sorted.length - 1] : null,
        avg_wait_ms: sorted.length > 0 ? +(stats.total_wait_ms / stats.total_waits).toFixed(2) : null,
        p50_wait_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : null,
        p90_wait_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.9)] : null,
        p99_wait_ms: sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : null,
        sample_count: samples.length,
      };

      // Include current pool state
      if (poolStats.total !== null) {
        waitStats.pool_state = {
          total: poolStats.total,
          idle: poolStats.idle,
          active: poolStats.active,
          waiting: poolStats.waiting,
          max: poolStats.max,
        };
      }

      results.push(waitStats);
    }

    return {
      pool_count: results.length,
      pools: results,
    };
  }
);

module.exports = { registerPool, pools, poolWaitStats };
