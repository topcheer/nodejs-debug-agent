'use strict';

const os = require('os');
const fs = require('fs');
const { debugTool } = require('../tool-registry');

// get_cpu_info
debugTool('get_cpu_info', 'Get CPU information: cores, model, load average', {})(
  async function getCpuInfo() {
    const cpus = os.cpus();
    return {
      core_count: cpus.length,
      model: cpus[0]?.model || 'unknown',
      speed_mhz: cpus[0]?.speed || 0,
      load_average: {
        '1min': os.loadavg()[0],
        '5min': os.loadavg()[1],
        '15min': os.loadavg()[2],
      },
    };
  }
);

// get_disk_usage
debugTool('get_disk_usage', 'Get disk usage for current working directory', {})(
  async function getDiskUsage() {
    try {
      const stats = fs.statfsSync(process.cwd());
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      return {
        total_gb: (total / 1024 ** 3).toFixed(2),
        free_gb: (free / 1024 ** 3).toFixed(2),
        used_pct: ((1 - free / total) * 100).toFixed(1),
      };
    } catch (e) {
      return { error: e.message };
    }
  }
);

// get_uptime
debugTool('get_uptime', 'Get process and system uptime', {})(
  async function getUptime() {
    return {
      process_uptime_seconds: Math.round(process.uptime()),
      system_uptime_seconds: Math.round(os.uptime()),
    };
  }
);


