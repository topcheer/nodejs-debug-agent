'use strict';

const os = require('os');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { debugTool } = require('../tool-registry');

// get_process_info — comprehensive process information
debugTool('get_process_info', 'Get comprehensive Node.js process info: PID, platform, arch, Node version, uptime, memory, and CPU usage', {})(
  async function getProcessInfo() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime_seconds: Math.round(process.uptime()),
      cpu_usage: {
        user_ms: Math.round(cpu.user / 1000),
        system_ms: Math.round(cpu.system / 1000),
      },
      memory: {
        rss_mb: (mem.rss / 1024 / 1024).toFixed(2),
        heap_total_mb: (mem.heapTotal / 1024 / 1024).toFixed(2),
        heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
        external_mb: (mem.external / 1024 / 1024).toFixed(2),
        array_buffers_mb: (mem.arrayBuffers / 1024 / 1024).toFixed(2),
      },
      cpu_count: os.cpus().length,
      load_average: os.loadavg(),
    };
  }
);

// get_event_loop_lag — measure event loop lag via perf_hooks
debugTool('get_event_loop_lag', 'Measure event loop lag and delay statistics using perf_hooks (current lag, P50/P95/P99 over recent window)', {})(
  async function getEventLoopLag() {
    // Measure current lag
    const currentLag = await new Promise(resolve => {
      const start = performance.now();
      setImmediate(() => resolve(performance.now() - start));
    });

    // Get histogram-based stats if available
    let histogramStats = null;
    try {
      const h = monitorEventLoopDelay({ resolution: 20 });
      h.enable();
      // Wait briefly to collect samples
      await new Promise(r => setTimeout(r, 200));
      h.disable();
      const toMs = ns => (ns / 1e6).toFixed(2);
      histogramStats = {
        min_ms: toMs(h.min),
        max_ms: toMs(h.max),
        mean_ms: toMs(h.mean),
        stddev_ms: toMs(h.stddev),
        p50_ms: toMs(h.percentile(50)),
        p90_ms: toMs(h.percentile(90)),
        p99_ms: toMs(h.percentile(99)),
      };
    } catch (e) {
      // monitorEventLoopDelay not available
    }

    return {
      current_lag_ms: currentLag.toFixed(2),
      histogram: histogramStats,
    };
  }
);

// get_resource_usage — process.resourceUsage() details
debugTool('get_resource_usage', 'Get process resource usage details: CPU time, max RSS, I/O operations, memory, and signals via process.resourceUsage()', {})(
  async function getResourceUsage() {
    if (typeof process.resourceUsage !== 'function') {
      return { error: 'process.resourceUsage() is not available in this Node.js version' };
    }
    const ru = process.resourceUsage();
    const toSec = v => (v / 1e6).toFixed(3);
    return {
      user_cpu_time_s: toSec(ru.userCPUTime),
      system_cpu_time_s: toSec(ru.systemCPUTime),
      max_rss_kb: ru.maxRSS,
      shared_memory_kb: ru.sharedMemorySize,
      unshared_data_kb: ru.unsharedDataSize,
      unshared_stack_kb: ru.unsharedStackSize,
      minor_page_faults: ru.minorPageFault,
      major_page_faults: ru.majorPageFault,
      block_input_ops: ru.blockedInputCount,
      block_output_ops: ru.blockedOutputCount,
      voluntary_context_switches: ru.voluntaryContextSwitches,
      involuntary_context_switches: ru.involuntaryContextSwitches,
    };
  }
);
