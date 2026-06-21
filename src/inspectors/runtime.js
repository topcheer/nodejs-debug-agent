'use strict';

const v8 = require('v8');
const os = require('os');
const { debugTool } = require('../tool-registry');

// get_heap_stats
debugTool('get_heap_stats', 'Get V8 heap statistics: total, used, free space', {})(
  async function getHeapStats() {
    const stats = v8.getHeapStatistics();
    return {
      total_heap_size_mb: (stats.total_heap_size / 1024 / 1024).toFixed(2),
      used_heap_size_mb: (stats.used_heap_size / 1024 / 1024).toFixed(2),
      heap_size_limit_mb: (stats.heap_size_limit / 1024 / 1024).toFixed(2),
      free_heap_mb: (stats.total_heap_size - stats.used_heap_size) / 1024 / 1024,
      malloced_memory_mb: (stats.malloced_memory / 1024 / 1024).toFixed(2),
      number_of_native_contexts: stats.number_of_native_contexts,
    };
  }
);

// trigger_gc
debugTool('trigger_gc', 'Trigger garbage collection and show before/after comparison', {})(
  async function triggerGc() {
    const before = v8.getHeapStatistics().used_heap_size;
    if (global.gc) {
      global.gc();
    } else {
      return { error: 'Run with --expose-gc to enable manual GC' };
    }
    const after = v8.getHeapStatistics().used_heap_size;
    return {
      used_before_mb: (before / 1024 / 1024).toFixed(2),
      used_after_mb: (after / 1024 / 1024).toFixed(2),
      freed_mb: ((before - after) / 1024 / 1024).toFixed(2),
    };
  }
);

// get_system_info
debugTool('get_system_info', 'Get system info: CPUs, load average, uptime', {})(
  async function getSystemInfo() {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpu_count: os.cpus().length,
      cpu_model: os.cpus()[0]?.model || 'unknown',
      total_memory_gb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2),
      free_memory_gb: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
      load_average: os.loadavg(),
      system_uptime: os.uptime(),
    };
  }
);

// get_v8_flags
debugTool('get_v8_flags', 'Get V8 engine flags and Harmony features status', {
  prefix: { type: 'string', description: 'Filter flags by prefix', required: false },
})(
  async function getV8Flags({ prefix }) {
    const flags = process.execArgv;
    const info = {
      v8_version: process.versions.v8,
      exec_argv: flags,
      harmony_flags: flags.filter(f => f.includes('harmony')),
    };
    if (prefix) {
      info.filtered = flags.filter(f => f.includes(prefix));
    }
    return info;
  }
);
