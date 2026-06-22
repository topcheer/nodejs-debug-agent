'use strict';

const { debugTool } = require('../tool-registry');

// ── get_cluster_info ──────────────────────────────────────────────
debugTool('get_cluster_info', 'Get Node.js cluster module information: isMaster/isPrimary, worker count, worker IDs, and per-worker status', {})(
  async function getClusterInfo() {
    let cluster;
    try { cluster = require('cluster'); } catch { return { error: 'cluster module not available' }; }

    const info = {
      is_master: cluster.isMaster,
      is_primary: cluster.isPrimary !== undefined ? cluster.isPrimary : cluster.isMaster,
      is_worker: cluster.isWorker,
      scheduling_policy: cluster.schedulingPolicy || 'unknown',
    };

    // List workers
    const workers = Object.entries(cluster.workers || {}).map(([id, worker]) => {
      const w = {
        id: Number(id),
        pid: worker.process?.pid,
        is_connected: worker.isConnected(),
        is_dead: worker.isDead(),
        suicide: worker.suicide,
      };

      // Worker process details
      if (worker.process) {
        w.process = {
          pid: worker.process.pid,
          killed: worker.process.killed,
          exit_code: worker.process.exitCode,
        };
      }

      return w;
    });

    info.worker_count = workers.length;
    info.worker_ids = workers.map(w => w.id);
    info.workers = workers;

    // Primary-specific info
    if (cluster.isPrimary) {
      info.settings = cluster.settings || {};
      info.setup_primary = typeof cluster.setupPrimary === 'function';
    }

    return info;
  }
);

// ── get_worker_threads ────────────────────────────────────────────
debugTool('get_worker_threads', 'List Node.js worker_threads status: active worker threads, their thread IDs, resource limits, and message ports', {})(
  async function getWorkerThreads() {
    let workerThreads;
    try {
      workerThreads = require('worker_threads');
    } catch {
      return { error: 'worker_threads not available in this environment' };
    }

    const info = {
      is_main_thread: workerThreads.isMainThread,
      thread_id: workerThreads.threadId,
      worker_threads: [],
    };

    // If we're in the main thread, try to discover active workers
    // Node.js doesn't have a global registry of worker_threads, so we scan active handles
    const handles = process._getActiveHandles ? process._getActiveHandles() : [];
    const messagePorts = [];
    const workerInstances = [];

    for (const handle of handles) {
      const typeName = handle.constructor?.name || '';

      // MessagePort instances indicate worker thread communication
      if (typeName === 'MessagePort' || (handle.constructor && handle.constructor.name === 'MessagePort')) {
        messagePorts.push({
          type: 'MessagePort',
          has_started: handle._started || false,
          closed: handle._closed || false,
        });
      }

      // Worker instances
      if (typeName === 'Worker' || (handle.constructor && handle.constructor.name === 'Worker')) {
        workerInstances.push({
          type: 'Worker',
          thread_id: handle.threadId,
          resource_limits: handle.resourceLimits || null,
        });
      }
    }

    // Also check active requests for any pending worker operations
    const requests = process._getActiveRequests ? process._getActiveRequests() : [];

    info.active_message_ports = messagePorts.length;
    info.active_workers = workerInstances.length;
    info.worker_threads = workerInstances;
    info.message_ports = messagePorts;

    // Resource limits of the current thread (if available)
    if (workerThreads.resourceLimits) {
      info.current_resource_limits = formatResourceLimits(workerThreads.resourceLimits);
    }

    // Parent port info (only in worker threads)
    if (!workerThreads.isMainThread) {
      info.parent_port = workerThreads.parentPort ? {
        type: 'MessagePort',
        closed: workerThreads.parentPort._closed || false,
      } : null;
    }

    return info;
  }
);

function formatResourceLimits(limits) {
  if (!limits) return null;
  const toMB = v => v != null ? (v / 1024 / 1024).toFixed(2) : undefined;
  return {
    max_old_generation_size_mb: toMB(limits.maxOldGenerationSizeMb),
    max_young_generation_size_mb: toMB(limits.maxYoungGenerationSizeMb),
    code_range_size_mb: toMB(limits.codeRangeSizeMb),
    stack_size_mb: toMB(limits.stackSizeMb),
  };
}

module.exports = {};
