'use strict';

const { debugTool } = require('../tool-registry');

// --- In-memory ring buffer for captured logs ---
const MAX_LOGS = 100;
const logBuffer = [];

function captureLog(level, args) {
  try {
    const entry = {
      timestamp: Date.now(),
      level,
      message: args.map(a => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      }).join(' '),
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  } catch (e) {
    // Never let logging capture crash the app
  }
}

// --- Auto-capture console.log/warn/error ---
let _patched = false;
function patchConsole() {
  if (_patched) return;
  _patched = true;

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = function (...args) {
    captureLog('info', args);
    return origLog.apply(console, args);
  };
  console.warn = function (...args) {
    captureLog('warn', args);
    return origWarn.apply(console, args);
  };
  console.error = function (...args) {
    captureLog('error', args);
    return origError.apply(console, args);
  };
}

// Patch immediately on load
patchConsole();

// --- Registered loggers registry ---
const loggers = new Map();

/**
 * Register a logger instance for inspection.
 * Supports winston, pino, bunyan, and custom loggers.
 */
function registerLogger(name, logger) {
  loggers.set(name, logger);
}

/**
 * Detect logger type and extract relevant info.
 */
function getLoggerInfo(name, logger) {
  const info = { name, type: 'unknown' };

  try {
    // Winston detection
    if (logger && typeof logger.level === 'string' && typeof logger.transports !== 'undefined') {
      info.type = 'winston';
      info.level = logger.level;
      info.transports = (Array.isArray(logger.transports) ? logger.transports : []).map(t => {
        const tInfo = { type: t.constructor ? t.constructor.name : 'unknown' };
        if (t.level) tInfo.level = t.level;
        return tInfo;
      });
    }
    // Pino detection
    else if (logger && typeof logger.level === 'string' && typeof logger.child === 'function') {
      info.type = 'pino';
      info.level = logger.level;
      info.transports = ['pino destination'];
    }
    // Bunyan detection
    else if (logger && typeof logger.level === 'function' && typeof logger.streams !== 'undefined') {
      info.type = 'bunyan';
      info.level = logger.level();
      info.streams = (logger.streams || []).map(s => ({
        type: s.type || 'stream',
        level: s.level,
      }));
    }
    // Generic fallback
    else {
      info.level = typeof logger.level === 'string' ? logger.level :
        typeof logger.level === 'function' ? safeCall(logger, 'level') : 'unknown';
    }
  } catch (e) {
    info.error = e.message;
  }

  return info;
}

function safeCall(obj, method) {
  try {
    return obj[method]();
  } catch (e) {
    return undefined;
  }
}

// get_log_buffer — return recent log entries from the ring buffer
debugTool('get_log_buffer', 'Return recent log entries from the built-in ring buffer (last 100 entries captured from console.log/warn/error)', {
  limit: { type: 'integer', description: 'Max results to return (most recent first)', required: false },
  level: { type: 'string', description: 'Filter by level: info, warn, error', required: false },
})(
  async function getLogBuffer({ limit, level }) {
    let entries = [...logBuffer].reverse(); // most recent first
    if (level) {
      entries = entries.filter(e => e.level === level);
    }
    if (limit) {
      entries = entries.slice(0, limit);
    }
    return {
      total_captured: logBuffer.length,
      returned: entries.length,
      entries,
    };
  }
);

// get_log_level — get current log level for registered loggers
debugTool('get_log_level', 'Get current log level for registered loggers (winston, pino, bunyan). Shows logger name, level, and transports.', {
  logger_name: { type: 'string', description: 'Specific logger name (omit to list all)', required: false },
})(
  async function getLogLevel({ logger_name }) {
    if (logger_name) {
      const logger = loggers.get(logger_name);
      if (!logger) {
        return { error: `No logger registered with name: ${logger_name}` };
      }
      return getLoggerInfo(logger_name, logger);
    }

    const all = [];
    for (const [name, logger] of loggers) {
      all.push(getLoggerInfo(name, logger));
    }
    return {
      logger_count: all.length,
      loggers: all,
    };
  }
);

// set_log_level — dynamically change log level
debugTool('set_log_level', 'Dynamically change the log level of a registered logger', {
  logger_name: { type: 'string', description: 'Name of the registered logger', required: true },
  level: { type: 'string', description: 'New log level (debug, info, warn, error)', required: true },
})(
  async function setLogLevel({ logger_name, level }) {
    const logger = loggers.get(logger_name);
    if (!logger) {
      return { error: `No logger registered with name: ${logger_name}` };
    }

    const validLevels = ['trace', 'debug', 'verbose', 'info', 'warn', 'warning', 'error', 'fatal', 'silent', 'none'];
    const normalized = String(level).toLowerCase();
    if (!validLevels.includes(normalized)) {
      return { error: `Invalid level: ${level}. Valid levels: ${validLevels.join(', ')}` };
    }

    try {
      // Winston
      if (typeof logger.level === 'string' || typeof logger.level === 'function') {
        logger.level = normalized;
        return { success: true, logger: logger_name, level: normalized };
      }
      // Pino / Bunyan
      if (typeof logger.level === 'function') {
        logger.level(normalized);
        return { success: true, logger: logger_name, level: normalized };
      }

      return { error: `Cannot determine how to set level on logger: ${logger_name}` };
    } catch (e) {
      return { error: e.message };
    }
  }
);

// get_log_transports — list configured transports/handlers
debugTool('get_log_transports', 'List configured transports/handlers for registered loggers', {
  logger_name: { type: 'string', description: 'Specific logger name (omit to list all)', required: false },
})(
  async function getLogTransports({ logger_name }) {
    function extractTransports(name, logger) {
      const info = getLoggerInfo(name, logger);
      return { name, type: info.type, transports: info.transports || [] };
    }

    if (logger_name) {
      const logger = loggers.get(logger_name);
      if (!logger) {
        return { error: `No logger registered with name: ${logger_name}` };
      }
      return extractTransports(logger_name, logger);
    }

    const result = [];
    for (const [name, logger] of loggers) {
      result.push(extractTransports(name, logger));
    }
    return { logger_count: result.length, loggers: result };
  }
);

module.exports = { registerLogger, captureLog };
