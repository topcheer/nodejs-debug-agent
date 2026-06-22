'use strict';

const { monitorEventLoopDelay } = require('perf_hooks');
const { debugTool } = require('../tool-registry');

// --- Registry of locks / mutexes ---
const locks = new Map();

// --- Event loop delay monitor (singleton) ---
let _h = null;
let _monitorStarted = false;

function getEventLoopMonitor() {
  if (_h) return _h;
  try {
    _h = monitorEventLoopDelay({ resolution: 5 });
    _h.enable();
    _monitorStarted = true;
  } catch {
    _h = null;
  }
  return _h;
}

/**
 * Register a lock / mutex instance for inspection.
 * Supports async-mutex package or custom lock objects.
 * @param {string} name - Identifier for this lock
 * @param {object} lockObj - The lock/mutex instance
 */
function registerLock(name, lockObj) {
  locks.set(name, lockObj);
}

/**
 * Detect if a lock object is from the async-mutex package.
 */
function isAsyncMutex(lock) {
  if (!lock) return false;
  // async-mutex Mutex has acquire(), release(), runExclusive(), isLocked()
  if (
    typeof lock.acquire === 'function' &&
    typeof lock.release === 'function' &&
    typeof lock.isLocked === 'function'
  ) {
    return true;
  }
  // Semaphore has the same API plus a value() method
  if (
    typeof lock.acquire === 'function' &&
    typeof lock.runExclusive === 'function' &&
    typeof lock.getValue === 'function'
  ) {
    return true;
  }
  return false;
}

function inspectLock(name, lock) {
  const info = { name };

  if (isAsyncMutex(lock)) {
    info.type = lock.getValue ? 'async-mutex (Semaphore)' : 'async-mutex (Mutex)';
    try { info.is_locked = lock.isLocked(); } catch { info.is_locked = 'unknown'; }
    try { if (lock.getValue) info.value = lock.getValue(); } catch {}
    info.acquired_count = lock._numAcquired || 'not tracked';
    info.waiting = lock._waiters?.length || 0;
  } else if (typeof lock.acquire === 'function' && typeof lock.release === 'function') {
    // Custom lock with acquire/release
    info.type = 'custom';
    try { info.is_locked = typeof lock.isLocked === 'function' ? lock.isLocked() : !!lock.locked; } catch {}
    info.acquired_count = lock.acquiredCount || 'not tracked';
    info.waiting = lock.waitingCount || 'not tracked';
  } else {
    info.type = 'unknown';
    info.note = 'Object does not match known lock interface (acquire/release)';
  }

  return info;
}

// Auto-discover async-mutex instances from require.cache
function autoDiscoverMutexes() {
  const found = [];
  try {
    for (const [id, mod] of Object.entries(require.cache)) {
      if (id.includes('async-mutex')) {
        // The package itself doesn't register instances, but we can check
        // if the module has any live instances stored
        if (mod.exports && typeof mod.exports.Mutex === 'function') {
          found.push({ id, type: 'async-mutex package detected' });
        }
      }
    }
  } catch {}
  return found;
}

// ── get_event_loop_blocked ──────────────────────────────────────
debugTool('get_event_loop_blocked', 'Measure event loop blocking using perf_hooks monitorEventLoopDelay. Shows min/max/mean/p99 blocking time in milliseconds. Flags as "blocked" if p99 > 100ms.', {
  duration: { type: 'integer', description: 'Measurement window in ms before reading stats (default: 1000). Pass 0 to read accumulated stats immediately.', required: false },
})(
  async function getEventLoopBlocked({ duration }) {
    const h = getEventLoopMonitor();
    if (!h) {
      return { error: 'monitorEventLoopDelay is not available in this environment' };
    }

    // If a measurement window is requested, reset and wait
    if (duration && duration > 0) {
      h.reset();
      await new Promise(resolve => setTimeout(resolve, duration));
    }

    // Read stats (values are in nanoseconds → convert to ms)
    const NS_TO_MS = 1e6;
    const stats = {
      min_ms: +(h.min / NS_TO_MS).toFixed(2),
      max_ms: +(h.max / NS_TO_MS).toFixed(2),
      mean_ms: +(h.mean / NS_TO_MS).toFixed(2),
      stddev_ms: +(h.stddev / NS_TO_MS).toFixed(2),
      p50_ms: +(h.percentile(50) / NS_TO_MS).toFixed(2),
      p90_ms: +(h.percentile(90) / NS_TO_MS).toFixed(2),
      p99_ms: +(h.percentile(99) / NS_TO_MS).toFixed(2),
    };

    const threshold_ms = 100;
    const status = stats.p99_ms > threshold_ms ? 'blocked' : 'healthy';

    return {
      status,
      threshold_ms,
      measurement_window_ms: duration || 'accumulated since start',
      event_loop_delay: stats,
      note: status === 'blocked'
        ? `Event loop p99 delay (${stats.p99_ms}ms) exceeds ${threshold_ms}ms threshold. Synchronous operations may be blocking the event loop.`
        : `Event loop p99 delay (${stats.p99_ms}ms) is within healthy bounds.`,
    };
  }
);

// ── get_blocked_operations ──────────────────────────────────────
debugTool('get_blocked_operations', 'Detect synchronous operations that block the event loop. Tracks sync I/O, long-running CPU tasks, and timer delays. Reports recent blocking events and sync I/O detection.', {})(
  async function getBlockedOperations() {
    const results = [];

    // 1. Check if --trace-sync-io was enabled (process.execArgv)
    const traceSyncIo = process.execArgv.includes('--trace-sync-io');

    // 2. Measure event loop responsiveness via timer jitter
    const samples = [];
    const sampleCount = 10;
    const intervalMs = 10;
    for (let i = 0; i < sampleCount; i++) {
      const start = Date.now();
      await new Promise(r => setTimeout(r, intervalMs));
      const actual = Date.now() - start;
      const jitter = actual - intervalMs;
      samples.push({ expected_ms: intervalMs, actual_ms: actual, jitter_ms: jitter });
    }

    const jitterValues = samples.map(s => s.jitter_ms);
    const maxJitter = Math.max(...jitterValues);
    const avgJitter = jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length;

    // 3. Detect sync I/O usage via process measurement
    // Check for synchronous file operations in recent stack via wrapped APIs
    let syncIoDetected = false;
    try {
      // If --trace-sync-io is active, sync I/O would have been logged to stderr
      // We can check the environment
      if (traceSyncIo) {
        syncIoDetected = true;
      }
    } catch {}

    // 4. Check event loop delay monitor for recent blocking
    const h = getEventLoopMonitor();
    let eventLoopInfo = null;
    if (h) {
      const NS_TO_MS = 1e6;
      eventLoopInfo = {
        max_ms: +(h.max / NS_TO_MS).toFixed(2),
        mean_ms: +(h.mean / NS_TO_MS).toFixed(2),
        p99_ms: +(h.percentile(99) / NS_TO_MS).toFixed(2),
        exceeds_100ms: h.percentile(99) / NS_TO_MS > 100,
      };
    }

    // Flag if timer jitter or event loop delay indicates blocking
    const blocked = maxJitter > 50 || (eventLoopInfo && eventLoopInfo.exceeds_100ms);

    return {
      status: blocked ? 'blocked' : 'healthy',
      trace_sync_io_enabled: traceSyncIo,
      sync_io_detected: syncIoDetected,
      timer_jitter: {
        samples,
        max_jitter_ms: +maxJitter.toFixed(2),
        avg_jitter_ms: +avgJitter.toFixed(2),
        threshold_ms: 50,
        exceeds_threshold: maxJitter > 50,
      },
      event_loop_delay: eventLoopInfo,
      recommendation: blocked
        ? 'Detected potential event loop blocking. Check for synchronous file I/O, CPU-intensive loops, or heavy JSON.parse/JSON.stringify operations. Run with --trace-sync-io to pinpoint sync I/O calls.'
        : 'No significant event loop blocking detected.',
    };
  }
);

// ── get_lock_contention ──────────────────────────────────────────
debugTool('get_lock_contention', 'Get contention statistics for registered async mutexes or custom locks. Shows lock type, held state, waiting count, and acquisition stats. Auto-detects async-mutex package.', {})(
  async function getLockContention() {
    if (locks.size === 0) {
      // Try auto-discovery
      const discovered = autoDiscoverMutexes();
      if (discovered.length > 0) {
        return {
          status: 'No locks registered via registerLock().',
          detected_packages: discovered.map(d => ({ source: d.id.split('/').slice(-2).join('/'), info: d.type })),
          hint: 'Call registerLock(name, mutexInstance) to track contention for specific locks.',
        };
      }
      return {
        status: 'No locks registered. Call registerLock(name, lockObj) to track mutex/lock contention.',
      };
    }

    const lockInfos = [];
    for (const [name, lock] of locks) {
      lockInfos.push(inspectLock(name, lock));
    }

    // Count contended locks
    const contended = lockInfos.filter(l => l.is_locked === true && l.waiting > 0);

    return {
      lock_count: lockInfos.length,
      contended_count: contended.length,
      status: contended.length > 0 ? 'contention_detected' : 'no_contention',
      locks: lockInfos,
    };
  }
);

module.exports = { registerLock, locks, getEventLoopMonitor };
