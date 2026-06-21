'use strict';

const { debugTool } = require('../tool-registry');

// In-memory ring buffer for HTTP request tracking
const MAX_REQUESTS = 500;
const buffer = [];

/**
 * Record an HTTP request. Call this from your middleware.
 */
function recordRequest(method, path, status, durationMs, client = '') {
  buffer.push({ timestamp: Date.now(), method, path, status, duration_ms: Math.round(durationMs * 100) / 100, client });
  if (buffer.length > MAX_REQUESTS) buffer.shift();
}

function getAll() {
  return [...buffer];
}

// get_recent_requests
debugTool('get_recent_requests', 'Get recent HTTP requests from the in-memory ring buffer', {
  limit: { type: 'integer', description: 'Max results to return', required: false },
})(
  async function getRecentRequests({ limit }) {
    let reqs = getAll();
    if (limit) reqs = reqs.slice(-limit);
    return { total: buffer.length, requests: reqs.reverse() };
  }
);

// get_slow_requests
debugTool('get_slow_requests', 'Get slowest HTTP requests sorted by duration', {
  threshold_ms: { type: 'number', description: 'Minimum duration in ms', required: false },
})(
  async function getSlowRequests({ threshold_ms }) {
    let reqs = getAll();
    if (threshold_ms) reqs = reqs.filter(r => r.duration_ms >= threshold_ms);
    reqs.sort((a, b) => b.duration_ms - a.duration_ms);
    return { count: reqs.length, requests: reqs.slice(0, 20) };
  }
);

// get_error_requests
debugTool('get_error_requests', 'Get all error requests (4xx/5xx status codes)', {})(
  async function getErrorRequests() {
    const reqs = getAll().filter(r => r.status >= 400);
    reqs.sort((a, b) => b.duration_ms - a.duration_ms);
    return { count: reqs.length, requests: reqs };
  }
);

// get_request_stats
debugTool('get_request_stats', 'Get HTTP request statistics: count, P50/P95/P99 latency, error rate', {})(
  async function getRequestStats() {
    const reqs = getAll();
    if (reqs.length === 0) return { message: 'No requests recorded yet' };

    const durations = reqs.map(r => r.duration_ms).sort((a, b) => a - b);
    const n = durations.length;
    const pct = p => durations[Math.min(Math.ceil(p * n) - 1, n - 1)];
    const errors = reqs.filter(r => r.status >= 400).length;

    const byPath = {};
    for (const r of reqs) byPath[r.path] = (byPath[r.path] || 0) + 1;

    return {
      total_requests: n,
      error_count: errors,
      error_rate: `${(errors / n * 100).toFixed(1)}%`,
      latency_ms: {
        min: durations[0],
        p50: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        max: durations[n - 1],
      },
      top_paths: Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((o, [k, v]) => ({ ...o, [k]: v }), {}),
    };
  }
);

module.exports = { recordRequest, getAll };
