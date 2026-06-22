'use strict';

const fs = require('fs');
const path = require('path');
const { debugTool } = require('../tool-registry');

// get_fd_info — open file descriptor count and system limits
debugTool('get_fd_info', 'Get open file descriptor count and system limits (RLIMIT_NOFILE). Works on Linux via /proc/self/fd and macOS via process methods.', {})(
  async function getFdInfo() {
    const info = {
      platform: process.platform,
      open_fds: null,
      soft_limit: null,
      hard_limit: null,
    };

    // Get RLIMIT_NOFILE
    try {
      // Node.js doesn't have a direct API for rlimit, try using process resource info
      if (typeof process.resourceUsage === 'function') {
        info.resource_usage_available = true;
      }
    } catch (e) {}

    // Try to get open FDs count
    try {
      if (process.platform === 'linux') {
        // Linux: read /proc/self/fd
        const fdDir = '/proc/self/fd';
        const fds = fs.readdirSync(fdDir);
        info.open_fds = fds.length;
        info.method = '/proc/self/fd';
      } else if (process.platform === 'darwin') {
        // macOS: use lsof or estimate from active handles
        // Try process._getActiveHandles as an approximation
        const handles = process._getActiveHandles ? process._getActiveHandles() : [];
        const fdCount = handles.filter(h => h && h.fd !== undefined && h.fd !== null).length;
        info.open_fds = fdCount;
        info.estimated = true;
        info.method = 'active_handles (approximation)';
        info.note = 'macOS does not expose exact FD count directly; this is an approximation from active handles';
      } else {
        info.open_fds = null;
        info.method = 'unsupported platform';
        info.note = `FD counting not supported on platform: ${process.platform}`;
      }
    } catch (e) {
      info.error = e.message;
    }

    // Try to get soft/hard limits
    try {
      // Use child_process to get ulimit
      const { execSync } = require('child_process');
      if (process.platform === 'linux' || process.platform === 'darwin') {
        try {
          // ulimit -n gives soft limit
          const softOut = execSync('ulimit -n', { encoding: 'utf8', timeout: 2000 }).trim();
          info.soft_limit = parseInt(softOut, 10) || null;
        } catch (e) {}
        try {
          // ulimit -Hn gives hard limit
          const hardOut = execSync('ulimit -Hn', { encoding: 'utf8', timeout: 2000 }).trim();
          info.hard_limit = parseInt(hardOut, 10) || null;
        } catch (e) {}
      }
    } catch (e) {}
    return info;
  }
);
