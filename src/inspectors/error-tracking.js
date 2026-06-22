'use strict';

const { debugTool } = require('../tool-registry');

// Ring buffer for captured errors
const errorBuffer = [];
const MAX_ERRORS = 50;

// Track whether process listeners are already installed
let listenersInstalled = false;

/**
 * Capture an error into the ring buffer.
 * @param {Error|any} err - The error to capture
 * @param {string} source - Where the error was captured from (uncaughtException, unhandledRejection, express-middleware, manual)
 * @param {object} [context] - Additional context (url, method, etc.)
 */
function captureError(err, source, context = {}) {
  const entry = {
    id: errorBuffer.length + 1,
    timestamp: new Date().toISOString(),
    message: err?.message || String(err),
    name: err?.name || (typeof err === 'string' ? 'String' : 'Error'),
    source,
    stack: err?.stack ? err.stack.split('\n').slice(0, 10).join('\n') : null,
    context,
  };

  errorBuffer.push(entry);
  // Ring buffer: remove oldest
  if (errorBuffer.length > MAX_ERRORS) {
    errorBuffer.shift();
  }
}

/**
 * Install process-level error listeners (idempotent).
 */
function installProcessListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  process.on('uncaughtException', (err) => {
    captureError(err, 'uncaughtException');
  });

  process.on('unhandledRejection', (err) => {
    captureError(err, 'unhandledRejection');
  });
}

// Auto-install on module load
installProcessListeners();

/**
 * Express error middleware factory that captures errors.
 * Usage: app.use(errorTrackingMiddleware())
 */
function errorTrackingMiddleware() {
  return function (err, req, res, next) {
    captureError(err, 'express-middleware', {
      method: req?.method,
      url: req?.url,
      status: err?.status || err?.statusCode || 500,
    });
    next(err);
  };
}

// ── get_recent_errors ─────────────────────────────────────────────
debugTool('get_recent_errors', 'List recent uncaught exceptions and errors captured via process.on(uncaughtException), process.on(unhandledRejection), and Express error middleware. Shows timestamp, message, source, and stack trace.', {
  source: { type: 'string', description: 'Filter by error source: uncaughtException, unhandledRejection, express-middleware', required: false },
  limit: { type: 'number', description: 'Maximum number of errors to return (default 20)', required: false },
})(
  async function getRecentErrors({ source, limit }) {
    if (errorBuffer.length === 0) {
      return {
        status: 'No errors captured yet. Errors are captured from uncaughtException, unhandledRejection, and Express error middleware.',
        buffer_size: 0,
        max_buffer: MAX_ERRORS,
      };
    }

    let errors = [...errorBuffer].reverse(); // Most recent first

    if (source) {
      errors = errors.filter(e => e.source === source);
    }

    const maxLimit = limit || 20;
    errors = errors.slice(0, maxLimit);

    return {
      total_captured: errorBuffer.length,
      max_buffer: MAX_ERRORS,
      returned: errors.length,
      filter: source ? { source } : null,
      errors,
    };
  }
);

// ── get_error_stats ───────────────────────────────────────────────
debugTool('get_error_stats', 'Compute error statistics: total count, rate per minute, top error types, and breakdown by source.', {})(
  async function getErrorStats() {
    const total = errorBuffer.length;

    if (total === 0) {
      return {
        total_errors: 0,
        message: 'No errors captured yet.',
      };
    }

    // Rate per minute (based on time span of captured errors)
    const now = Date.now();
    const oldest = new Date(errorBuffer[0].timestamp).getTime();
    const spanMinutes = Math.max((now - oldest) / 60000, 1 / 60); // at least 1 second
    const ratePerMinute = +(total / spanMinutes).toFixed(2);

    // Breakdown by source
    const bySource = {};
    for (const e of errorBuffer) {
      bySource[e.source] = (bySource[e.source] || 0) + 1;
    }

    // Top error types (by name)
    const byName = {};
    for (const e of errorBuffer) {
      byName[e.name] = (byName[e.name] || 0) + 1;
    }
    const topTypes = Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ error_type: name, count }));

    // Recent trend (errors in last 5 minutes)
    const fiveMinAgo = now - 5 * 60 * 1000;
    const recentCount = errorBuffer.filter(e => new Date(e.timestamp).getTime() > fiveMinAgo).length;

    return {
      total_errors: total,
      rate_per_minute: ratePerMinute,
      recent_5min: recentCount,
      by_source: bySource,
      top_error_types: topTypes,
      time_span_minutes: +spanMinutes.toFixed(2),
      buffer_size: total,
      max_buffer: MAX_ERRORS,
    };
  }
);

// ── get_error_patterns ────────────────────────────────────────────
debugTool('get_error_patterns', 'Group captured errors into patterns by message and stack signature. Shows recurring error patterns with occurrence counts and first/last seen timestamps.', {})(
  async function getErrorPatterns() {
    if (errorBuffer.length === 0) {
      return { status: 'No errors captured yet.', pattern_count: 0, patterns: [] };
    }

    const patterns = new Map();

    for (const error of errorBuffer) {
      // Create a signature from the error message (normalize variable parts)
      const normalized = normalizeMessage(error.message);
      const signature = `${error.name}:${normalized}`;

      if (!patterns.has(signature)) {
        patterns.set(signature, {
          pattern: normalized,
          error_name: error.name,
          signature,
          count: 0,
          first_seen: error.timestamp,
          last_seen: error.timestamp,
          sources: new Set(),
          sample_stack: error.stack,
        });
      }

      const p = patterns.get(signature);
      p.count++;
      p.sources.add(error.source);
      if (error.timestamp < p.first_seen) p.first_seen = error.timestamp;
      if (error.timestamp > p.last_seen) p.last_seen = error.timestamp;
    }

    const result = [...patterns.values()]
      .sort((a, b) => b.count - a.count)
      .map(p => ({
        ...p,
        sources: [...p.sources],
      }));

    return {
      total_errors: errorBuffer.length,
      pattern_count: result.length,
      patterns: result,
    };
  }
);

/**
 * Normalize an error message by replacing variable parts (IDs, numbers, paths)
 * so similar errors group into the same pattern.
 */
function normalizeMessage(msg) {
  if (!msg) return '(no message)';
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    .replace(/\/[\w\-./]+:\d+:\d+/g, 'FILE:LINE')
    .replace(/ECONNREFUSED.*$/s, 'ECONNREFUSED')
    .replace(/\b\d+\b/g, 'N');
}

module.exports = { captureError, errorTrackingMiddleware, errorBuffer, MAX_ERRORS };
