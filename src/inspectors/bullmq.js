'use strict';

const { debugTool } = require('../tool-registry');

// Registry of Bull/BullMQ queues
const bullQueues = new Map();

/**
 * Register a Bull/BullMQ queue for inspection.
 * @param {string} name - Identifier for this queue
 * @param {object} queue - Bull or BullMQ Queue instance
 */
function registerBullQueue(name, queue) {
  bullQueues.set(name, queue);
}

// ── get_bull_queues ───────────────────────────────────────────────
debugTool('get_bull_queues', 'List registered Bull/BullMQ queues with job counts (active, completed, delayed, failed, pending/waiting)', {})(
  async function getBullQueues() {
    if (bullQueues.size === 0) {
      return { status: 'No Bull/BullMQ queues registered. Call registerBullQueue(name, queue) first.' };
    }

    const results = [];

    for (const [name, queue] of bullQueues) {
      try {
        const counts = await getQueueCounts(queue);
        results.push({
          name,
          type: detectQueueType(queue),
          ...counts,
        });
      } catch (e) {
        results.push({
          name,
          error: e.message,
          type: detectQueueType(queue),
        });
      }
    }

    return {
      queue_count: results.length,
      queues: results,
    };
  }
);

// ── get_bull_queue_stats ──────────────────────────────────────────
debugTool('get_bull_queue_stats', 'Get per-queue throughput metrics for Bull/BullMQ queues (processed, failed totals, throughput, rates)', {
  queue_name: { type: 'string', description: 'Specific queue name. If omitted, returns stats for all registered queues.', required: false },
})(
  async function getBullQueueStats({ queue_name }) {
    const targets = queue_name ? [[queue_name, bullQueues.get(queue_name)]] : [...bullQueues];
    const queuesToCheck = targets.filter(([name, q]) => q);

    if (queuesToCheck.length === 0) {
      return { error: bullQueues.size === 0 ? 'No Bull/BullMQ queues registered' : `Queue "${queue_name}" not found` };
    }

    const results = [];

    for (const [name, queue] of queuesToCheck) {
      try {
        const stats = await getQueueThroughput(queue);
        results.push({ name, ...stats });
      } catch (e) {
        results.push({ name, error: e.message });
      }
    }

    return { queue_count: results.length, queues: results };
  }
);

// ── Helpers ───────────────────────────────────────────────────────

function detectQueueType(queue) {
  if (!queue) return 'unknown';
  // BullMQ v3+ has isQueue() or named differently from Bull
  if (queue.constructor && queue.constructor.name === 'Queue') {
    // Distinguish BullMQ from Bull
    if (typeof queue.drain === 'function' && typeof queue.removeCompleted === 'function') return 'bullmq';
    if (queue.opts && queue.opts.connection && queue.opts.connection.constructor) return 'bullmq';
    return 'bull';
  }
  return queue.constructor?.name || 'unknown';
}

/**
 * Get job counts for a Bull or BullMQ queue.
 */
async function getQueueCounts(queue) {
  // BullMQ v3+ / Bull v4+ both support getJobCounts()
  if (typeof queue.getJobCounts === 'function') {
    const counts = await queue.getJobCounts();
    return {
      active: counts.active || 0,
      completed: counts.completed || 0,
      delayed: counts.delayed || 0,
      failed: counts.failed || 0,
      waiting: counts.waiting || counts.pending || 0,
      prioritized: counts.prioritized || 0,
      paused: counts.paused || 0,
    };
  }

  // Older Bull: individual count methods
  const counts = {};
  const methods = ['getActiveCount', 'getCompletedCount', 'getDelayedCount', 'getFailedCount', 'getWaitingCount'];
  const labels = ['active', 'completed', 'delayed', 'failed', 'waiting'];
  for (let i = 0; i < methods.length; i++) {
    if (typeof queue[methods[i]] === 'function') {
      counts[labels[i]] = await queue[methods[i]]();
    }
  }
  return counts;
}

/**
 * Get throughput metrics for a Bull or BullMQ queue.
 */
async function getQueueThroughput(queue) {
  const stats = {};

  // Bull stores metrics via the client/redis
  // BullMQ v3+ has getMetrics() on the queue
  if (typeof queue.getMetrics === 'function') {
    try {
      const metrics = await queue.getMetrics('completed');
      stats.completed_metrics = {
        count: metrics.count || 0,
        data: metrics.data || [],
      };

      const failedMetrics = await queue.getMetrics('failed');
      stats.failed_metrics = {
        count: failedMetrics.count || 0,
        data: failedMetrics.data || [],
      };
    } catch (e) {}
  }

  // Get counts for throughput calculation
  const counts = await getQueueCounts(queue);
  stats.total_processed = (counts.completed || 0) + (counts.active || 0);
  stats.total_failed = counts.failed || 0;
  stats.total_jobs = stats.total_processed + (counts.waiting || 0) + (counts.delayed || 0);
  stats.success_rate = stats.total_processed > 0
    ? `${((counts.completed || 0) / stats.total_processed * 100).toFixed(1)}%`
    : 'n/a';

  // Try to get the queue's redis connection info
  try {
    if (queue.opts && queue.opts.connection) {
      const conn = queue.opts.connection;
      stats.connection = {
        host: conn.host || (conn.srvRecord && conn.srvRecord.host) || 'localhost',
        port: conn.port || 6379,
        db: conn.db || 0,
      };
    }
  } catch (e) {}

  // Queue name and prefix
  try {
    stats.queue_name = queue.name || 'unknown';
    stats.prefix = queue.opts?.prefix || 'bull';
  } catch (e) {}

  return stats;
}

module.exports = { registerBullQueue, bullQueues };
