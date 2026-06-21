'use strict';

const { debugTool } = require('../tool-registry');

// get_db_pool_status — inspect connection pools for pg, mysql2, or mongodb
debugTool('get_db_pool_status', 'Get database connection pool status for pg (PostgreSQL), mysql2 (MySQL), or mongodb if loaded in require.cache', {
  driver: { type: 'string', description: 'Specific driver to inspect: pg, mysql2, or mongodb. If omitted, auto-detect all.', required: false },
})(
  async function getDbPoolStatus({ driver }) {
    const results = [];

    // ── PostgreSQL (pg) ──
    if (!driver || driver === 'pg') {
      const pg = safeRequire('pg');
      if (pg) {
        const pools = [];
        // Walk require.cache to find Pool instances
        for (const [id, mod] of Object.entries(require.cache)) {
          if (mod.exports instanceof pg.Pool) {
            const pool = mod.exports;
            pools.push(inspectPgPool(id, pool));
          }
          // Check for Pool attached to module
          if (mod.exports?.Pool && mod.exports instanceof pg.Pool) {
            pools.push(inspectPgPool(id, mod.exports));
          }
        }
        if (pools.length > 0) {
          results.push({ driver: 'pg', pools });
        } else {
          results.push({ driver: 'pg', status: 'loaded but no Pool instances found' });
        }
      }
    }

    // ── MySQL (mysql2) ──
    if (!driver || driver === 'mysql2') {
      const mysql2 = safeRequire('mysql2');
      if (mysql2) {
        const pools = [];
        for (const [id, mod] of Object.entries(require.cache)) {
          // mysql2 pools are instances with _allConnections
          const exp = mod.exports;
          if (exp && exp._allConnections && typeof exp.getConnection === 'function') {
            pools.push({
              source: shortPath(id),
              total_connections: exp._allConnections.length,
              free_connections: exp._freeConnections.length,
              waiting_callbacks: exp._connectionQueue.length,
              config: exp.config?.connectionLimit ?
                { connection_limit: exp.config.connectionLimit } : undefined,
            });
          }
        }
        if (pools.length > 0) {
          results.push({ driver: 'mysql2', pools });
        } else {
          results.push({ driver: 'mysql2', status: 'loaded but no pool instances found' });
        }
      }
    }

    // ── MongoDB ──
    if (!driver || driver === 'mongodb') {
      const mongodb = safeRequire('mongodb');
      if (mongodb) {
        const pools = [];
        for (const [id, mod] of Object.entries(require.cache)) {
          const exp = mod.exports;
          // MongoClient or topology instances
          if (exp && exp.topology && exp.topology.s) {
            const topo = exp.topology;
            pools.push({
              source: shortPath(id),
              server_count: topo.s?.servers?.size || 0,
              state: topo.s?.state || 'unknown',
            });
          }
        }
        if (pools.length > 0) {
          results.push({ driver: 'mongodb', pools });
        } else {
          results.push({ driver: 'mongodb', status: 'loaded but no MongoClient instances found' });
        }
      }
    }

    if (results.length === 0) {
      return {
        status: 'No database drivers (pg, mysql2, mongodb) loaded in require.cache',
        drivers_checked: driver ? [driver] : ['pg', 'mysql2', 'mongodb'],
      };
    }

    return { drivers: results };
  }
);

function inspectPgPool(id, pool) {
  return {
    source: shortPath(id),
    total_count: pool.totalCount,
    idle_count: pool.idleCount,
    waiting_count: pool.waitingCount,
    options: pool.options ? {
      max: pool.options.max,
      idle_timeout_ms: pool.options.idleTimeoutMillis,
      connection_timeout_ms: pool.options.connectionTimeoutMillis,
    } : undefined,
  };
}

function shortPath(id) {
  const parts = id.split('/');
  return parts.slice(-3).join('/');
}

function safeRequire(name) {
  try { return require(name); } catch { return null; }
}
