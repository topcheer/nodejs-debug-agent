'use strict';

const { debugTool } = require('../tool-registry');

// Registry of Redis clients (ioredis or node-redis)
const redisClients = new Map();

/**
 * Register a Redis client for inspection.
 * @param {string} name - Identifier for this client
 * @param {object} client - ioredis or node-redis client instance
 */
function registerRedisClient(name, client) {
  redisClients.set(name, client);
}

// Detect client type: 'ioredis' | 'node-redis' | 'unknown'
function detectClientType(client) {
  if (!client) return 'unknown';
  if (client.constructor && client.constructor.name === 'Redis') return 'ioredis';
  if (typeof client.createCommand === 'function' || client.options !== undefined && client.isOpen !== undefined) {
    return 'node-redis';
  }
  if (client.constructor && client.constructor.name === 'Commander') return 'node-redis';
  // Fallback heuristics
  if (typeof client.sendCommand === 'function' && typeof client.duplicate === 'function') return 'ioredis';
  if (typeof client.connect === 'function' && typeof client.disconnect === 'function') return 'node-redis';
  return 'unknown';
}

// ── get_redis_pool_stats ──────────────────────────────────────────
debugTool('get_redis_pool_stats', 'Get Redis connection pool/client stats for all registered ioredis or node-redis clients (connection name, host, port, status)', {})(
  async function getRedisPoolStats() {
    if (redisClients.size === 0) {
      return { status: 'No Redis clients registered. Call registerRedisClient(name, client) first.' };
    }

    const results = [];
    for (const [name, client] of redisClients) {
      const type = detectClientType(client);
      if (type === 'ioredis') {
        results.push(inspectIoredis(name, client));
      } else if (type === 'node-redis') {
        results.push(inspectNodeRedis(name, client));
      } else {
        results.push({ name, type: 'unknown', status: 'Unable to detect Redis client type' });
      }
    }

    return { client_count: results.length, clients: results };
  }
);

function inspectIoredis(name, client) {
  const info = {
    name,
    type: 'ioredis',
    status: client.status || 'unknown',
    connection_name: client.options?.name || null,
    host: client.options?.host || 'localhost',
    port: client.options?.port || 6379,
    db: client.options?.db || 0,
  };

  // Connection pool stats
  if (client.connectionPool) {
    const pool = client.connectionPool;
    info.pool = {
      max: client.options?.maxConnections || pool._idleMax || 'n/a',
      idle: pool.idle ? pool.idle.length : undefined,
      waiting: pool.waiting ? pool.waiting.length : undefined,
    };
  }

  return info;
}

function inspectNodeRedis(name, client) {
  const info = {
    name,
    type: 'node-redis',
    status: client.isOpen ? 'ready' : 'closed',
    host: client.options?.socket?.host || 'localhost',
    port: client.options?.socket?.port || 6379,
    database: client.options?.database || 0,
    username: client.options?.username || 'default',
  };

  // node-redis v4+ exposes client.serverInfo after connect
  if (client.serverInfo) {
    info.server_version = client.serverInfo.version || undefined;
    info.server_mode = client.serverInfo.mode || undefined;
  }

  return info;
}

// ── get_redis_info ────────────────────────────────────────────────
debugTool('get_redis_info', 'Execute the Redis INFO command and parse key sections (Server, Clients, Memory, Stats, Keyspace) for registered clients', {
  client_name: { type: 'string', description: 'Specific registered client name. If omitted, uses the first registered client.', required: false },
  section: { type: 'string', description: 'Specific INFO section to retrieve (e.g., server, clients, memory, stats, keyspace). Default: default (all).', required: false },
})(
  async function getRedisInfo({ client_name, section }) {
    const client = resolveClient(client_name);
    if (!client) {
      return { error: redisClients.size === 0 ? 'No Redis clients registered' : `Client "${client_name}" not found` };
    }

    try {
      const raw = await executeCommand(client, 'INFO', section || 'default');
      const parsed = parseRedisInfo(raw);
      return { client: client_name || firstClientName(), section: section || 'default', info: parsed };
    } catch (e) {
      return { error: e.message };
    }
  }
);

function parseRedisInfo(raw) {
  if (typeof raw !== 'string') return raw;

  const sections = {};
  let currentSection = 'misc';

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header: # Server, # Clients, etc.
    if (trimmed.startsWith('#')) {
      currentSection = trimmed.slice(1).trim().toLowerCase();
      continue;
    }

    const eqIdx = trimmed.indexOf(':');
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();

    if (!sections[currentSection]) sections[currentSection] = {};
    sections[currentSection][key] = isNaN(value) ? value : Number(value);
  }

  return sections;
}

// ── get_redis_latency ─────────────────────────────────────────────
debugTool('get_redis_latency', 'Measure Redis PING latency over 10 samples, reporting min/avg/max in milliseconds', {
  client_name: { type: 'string', description: 'Specific registered client name. If omitted, uses the first registered client.', required: false },
})(
  async function getRedisLatency({ client_name }) {
    const client = resolveClient(client_name);
    if (!client) {
      return { error: redisClients.size === 0 ? 'No Redis clients registered' : `Client "${client_name}" not found` };
    }

    const samples = 10;
    const latencies = [];

    for (let i = 0; i < samples; i++) {
      const start = process.hrtime.bigint();
      try {
        await executeCommand(client, 'PING');
      } catch (e) {
        return { error: `PING failed: ${e.message}` };
      }
      const elapsedNs = Number(process.hrtime.bigint() - start);
      latencies.push(elapsedNs / 1e6); // convert to ms
    }

    latencies.sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      client: client_name || firstClientName(),
      samples,
      min_ms: +latencies[0].toFixed(3),
      avg_ms: +(sum / samples).toFixed(3),
      max_ms: +latencies[samples - 1].toFixed(3),
      p50_ms: +latencies[Math.floor(samples * 0.5)].toFixed(3),
    };
  }
);

// ── get_redis_db_size ─────────────────────────────────────────────
debugTool('get_redis_db_size', 'Execute the Redis DBSIZE command to get the total number of keys in the current database', {
  client_name: { type: 'string', description: 'Specific registered client name. If omitted, uses the first registered client.', required: false },
})(
  async function getRedisDbSize({ client_name }) {
    const client = resolveClient(client_name);
    if (!client) {
      return { error: redisClients.size === 0 ? 'No Redis clients registered' : `Client "${client_name}" not found` };
    }

    try {
      const size = await executeCommand(client, 'DBSIZE');
      return {
        client: client_name || firstClientName(),
        db_size: typeof size === 'number' ? size : Number(size),
      };
    } catch (e) {
      return { error: e.message };
    }
  }
);

// ── Helpers ───────────────────────────────────────────────────────

function resolveClient(name) {
  if (name) return redisClients.get(name);
  // Return the first registered client
  for (const [, client] of redisClients) return client;
  return null;
}

function firstClientName() {
  for (const [name] of redisClients) return name;
  return null;
}

/**
 * Execute a Redis command on either ioredis or node-redis.
 */
async function executeCommand(client, ...args) {
  const type = detectClientType(client);

  if (type === 'ioredis') {
    // ioredis: client.call(command, ...args)
    if (args[0] === 'PING') return client.ping();
    if (args[0] === 'DBSIZE') return client.dbsize();
    if (args[0] === 'INFO') return client.info(args[1] && args[1] !== 'default' ? args[1] : undefined);
    return client.call(...args);
  }

  // node-redis: client.sendCommand({ command, args })
  const command = args[0].toLowerCase();
  const cmdArgs = args.slice(1).filter(a => a && a !== 'default');

  if (command === 'ping') return client.ping();
  if (command === 'dbsize') return client.dbSize ? client.dbSize() : client.sendCommand({ command: 'DBSIZE' });
  if (command === 'info') {
    // node-redis v4+ returns a function client.info()
    if (typeof client.info === 'function') return client.info(cmdArgs[0] || undefined);
    return client.sendCommand({ command: 'INFO', args: cmdArgs });
  }

  return client.sendCommand({ command, args: cmdArgs });
}

module.exports = { registerRedisClient, redisClients };
