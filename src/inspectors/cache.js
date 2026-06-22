'use strict';

const { debugTool } = require('../tool-registry');

// --- Registered caches ---
const caches = new Map();

/**
 * Register a cache instance for inspection.
 * Supports node-cache, lru-cache, Map, and custom objects.
 */
function registerCache(name, cacheObj) {
  caches.set(name, cacheObj);
}

/**
 * Detect cache type and extract statistics.
 */
function detectCacheType(cache) {
  if (!cache) return 'unknown';
  // Map — check first since Map also has keys/get/size
  if (cache instanceof Map) {
    return 'map';
  }
  // node-cache: has getStats() returning {keys, hits, misses}
  if (typeof cache.getStats === 'function' && typeof cache.keys === 'function') {
    return 'node-cache';
  }
  // lru-cache: has .size, .get, .keys() but not getStats()
  if (typeof cache.keys === 'function' && typeof cache.get === 'function' && typeof cache.size === 'number') {
    return 'lru-cache';
  }
  // Custom with getStats
  if (typeof cache.getStats === 'function') {
    return 'custom';
  }
  return 'unknown';
}

function getCacheStatsInternal(name, cache) {
  const type = detectCacheType(cache);
  const stats = { name, type };

  try {
    switch (type) {
      case 'node-cache': {
        const s = cache.getStats();
        stats.keys = s.keys;
        stats.hits = s.hits;
        stats.misses = s.misses;
        stats.hit_rate = (s.hits + s.misses) > 0
          ? `${(s.hits / (s.hits + s.misses) * 100).toFixed(1)}%`
          : 'N/A';
        stats.ksize = s.ksize;
        stats.vsize = s.vsize;
        break;
      }
      case 'lru-cache': {
        stats.size = cache.size;
        stats.calculated_size = cache.calculatedSize !== undefined ? cache.calculatedSize : undefined;
        // lru-cache doesn't track hit/miss stats natively
        stats.hits = 'not tracked';
        stats.misses = 'not tracked';
        stats.hit_rate = 'not tracked';
        break;
      }
      case 'map': {
        stats.size = cache.size;
        stats.hits = 'not tracked';
        stats.misses = 'not tracked';
        stats.hit_rate = 'not tracked';
        break;
      }
      case 'custom': {
        const s = cache.getStats();
        Object.assign(stats, s);
        if (s.size !== undefined) stats.size = s.size;
        break;
      }
      default:
        stats.error = 'Unable to determine cache type';
    }
  } catch (e) {
    stats.error = e.message;
  }

  return stats;
}

function getCacheKeysInternal(cache, prefix) {
  const type = detectCacheType(cache);
  let keys = [];

  try {
    switch (type) {
      case 'node-cache':
      case 'custom':
        keys = typeof cache.keys === 'function' ? cache.keys() : [];
        break;
      case 'lru-cache':
        keys = typeof cache.keys === 'function' ? [...cache.keys()] : [];
        break;
      case 'map':
        keys = [...cache.keys()];
        break;
      default:
        return [];
    }
  } catch (e) {
    return [];
  }

  // Convert to strings for filtering
  keys = keys.map(k => (typeof k === 'string' ? k : String(k)));
  if (prefix) {
    keys = keys.filter(k => k.startsWith(prefix));
  }
  return keys;
}

// get_cache_stats — stats for registered caches
debugTool('get_cache_stats', 'Get statistics for registered caches (hit rate, miss count, key count, size). Supports node-cache, lru-cache, Map, and custom.', {
  cache_name: { type: 'string', description: 'Specific cache name (omit to list all)', required: false },
})(
  async function getCacheStats({ cache_name }) {
    if (cache_name) {
      const cache = caches.get(cache_name);
      if (!cache) {
        return { error: `No cache registered with name: ${cache_name}` };
      }
      return getCacheStatsInternal(cache_name, cache);
    }

    const all = [];
    for (const [name, cache] of caches) {
      all.push(getCacheStatsInternal(name, cache));
    }
    return { cache_count: all.length, caches: all };
  }
);

// get_cache_keys — list keys with optional prefix filter
debugTool('get_cache_keys', 'List keys from a registered cache with optional prefix filter', {
  cache_name: { type: 'string', description: 'Name of the registered cache', required: true },
  prefix: { type: 'string', description: 'Only return keys starting with this prefix', required: false },
})(
  async function getCacheKeys({ cache_name, prefix }) {
    const cache = caches.get(cache_name);
    if (!cache) {
      return { error: `No cache registered with name: ${cache_name}` };
    }
    const keys = getCacheKeysInternal(cache, prefix);
    return {
      cache_name,
      key_count: keys.length,
      keys,
    };
  }
);

// clear_cache — clear entries from a registered cache
debugTool('clear_cache', 'Clear all entries from a registered cache', {
  cache_name: { type: 'string', description: 'Name of the registered cache to clear', required: true },
})(
  async function clearCache({ cache_name }) {
    const cache = caches.get(cache_name);
    if (!cache) {
      return { error: `No cache registered with name: ${cache_name}` };
    }

    const type = detectCacheType(cache);
    try {
      switch (type) {
        case 'node-cache':
          cache.flushAll();
          return { success: true, cache_name, action: 'cleared', type };
        case 'lru-cache':
          if (typeof cache.clear === 'function') {
            cache.clear();
          } else if (typeof cache.reset === 'function') {
            cache.reset();
          } else {
            // Manual clear
            for (const k of [...(cache.keys ? cache.keys() : [])]) cache.delete(k);
          }
          return { success: true, cache_name, action: 'cleared', type };
        case 'map':
          cache.clear();
          return { success: true, cache_name, action: 'cleared', type };
        case 'custom':
          if (typeof cache.flushAll === 'function') {
            cache.flushAll();
          } else if (typeof cache.reset === 'function') {
            cache.reset();
          } else if (typeof cache.clear === 'function') {
            cache.clear();
          } else {
            return { error: `Cache type '${type}' has no clear/flush method` };
          }
          return { success: true, cache_name, action: 'cleared', type };
        default:
          return { error: `Cannot clear unknown cache type` };
      }
    } catch (e) {
      return { error: e.message };
    }
  }
);

module.exports = { registerCache };
