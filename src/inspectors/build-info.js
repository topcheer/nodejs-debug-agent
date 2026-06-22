'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { debugTool } = require('../tool-registry');

/**
 * Try to read app version from package.json.
 */
function getAppVersion() {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return {
      name: pkg.name || 'unknown',
      version: pkg.version || 'unknown',
      description: pkg.description || '',
    };
  } catch (e) {
    return null;
  }
}

/**
 * get_build_info — Return Node.js, V8, platform, and app build information.
 */
debugTool('get_build_info', 'Get build information: Node.js version, V8 version, platform, arch, OpenSSL version, npm version, and app version from package.json', {})(
  async function getBuildInfo() {
    const versions = process.versions;
    const appInfo = getAppVersion();

    return {
      node_version: versions.node,
      v8_version: versions.v8,
      uv_version: versions.uv,
      zlib_version: versions.zlib,
      openssl_version: versions.openssl,
      ares_version: versions.ares,
      modules_version: versions.modules,
      http_parser_version: versions.http_parser || 'n/a',
      llhttp_version: versions.llhttp || 'n/a',
      platform: process.platform,
      arch: process.arch,
      release: process.release ? {
        name: process.release.name || '',
        source_url: process.release.sourceUrl || '',
        headers_url: process.release.headersUrl || '',
      } : null,
      app: appInfo,
    };
  }
);

/**
 * get_deployment_info — Return deployment environment information.
 */
debugTool('get_deployment_info', 'Get deployment information: hostname, PID, uptime, container detection, memory limit, CPU cores, environment variables', {})(
  async function getDeploymentInfo() {
    let containerDetected = false;
    let containerType = null;

    // Check for Docker
    try {
      if (fs.existsSync('/.dockerenv')) {
        containerDetected = true;
        containerType = 'docker';
      }
    } catch (e) {}

    // Check for Kubernetes (via cgroups)
    if (!containerDetected) {
      try {
        if (process.env.KUBERNETES_SERVICE_HOST) {
          containerDetected = true;
          containerType = 'kubernetes';
        }
      } catch (e) {}
    }

    // Check for generic container via cgroup
    if (!containerDetected) {
      try {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('kubepods') || cgroup.includes('containerd')) {
          containerDetected = true;
          containerType = cgroup.includes('kubepods') ? 'kubernetes' : 'container';
        }
      } catch (e) {}
    }

    const mem = process.memoryUsage();
    const totalMemMB = os.totalmem() / 1024 / 1024;

    // Try to read memory limit (cgroup v1/v2)
    let memoryLimit = null;
    try {
      const limitV1 = fs.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim();
      const limitVal = parseInt(limitV1, 10);
      if (limitVal > 0 && limitVal < Number.MAX_SAFE_INTEGER) {
        memoryLimit = limitVal;
      }
    } catch (e) {}
    if (!memoryLimit) {
      try {
        const limitV2 = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
        const limitVal = parseInt(limitV2, 10);
        if (limitVal > 0 && limitVal < Number.MAX_SAFE_INTEGER) {
          memoryLimit = limitVal;
        }
      } catch (e) {}
    }

    return {
      hostname: os.hostname(),
      pid: process.pid,
      ppid: process.ppid,
      uptime_seconds: Math.round(process.uptime()),
      container: {
        detected: containerDetected,
        type: containerType,
      },
      memory: {
        system_total_mb: parseFloat(totalMemMB.toFixed(2)),
        system_free_mb: parseFloat((os.freemem() / 1024 / 1024).toFixed(2)),
        process_rss_mb: parseFloat((mem.rss / 1024 / 1024).toFixed(2)),
        process_heap_used_mb: parseFloat((mem.heapUsed / 1024 / 1024).toFixed(2)),
        cgroup_limit_bytes: memoryLimit,
        cgroup_limit_mb: memoryLimit ? parseFloat((memoryLimit / 1024 / 1024).toFixed(2)) : null,
      },
      cpu_cores: os.cpus().length,
      cpu_model: os.cpus()[0] ? os.cpus()[0].model : 'unknown',
      environment: {
        NODE_ENV: process.env.NODE_ENV || 'undefined',
        APP_ENV: process.env.APP_ENV || 'undefined',
      },
      cwd: process.cwd(),
      exec_path: process.execPath,
    };
  }
);

/**
 * get_runtime_version — Return key dependency versions from package.json or require.cache.
 */
debugTool('get_runtime_version', 'Get key dependency versions (express, react, next, lodash, etc.) from package.json or require.cache', {
  packages: { type: 'string', description: 'Comma-separated package names to check (default: auto-detect common ones)', required: false },
})(
  async function getRuntimeVersion({ packages }) {
    // Default packages to check
    const defaultPkgs = [
      'express', 'fastify', 'koa', 'next', 'nuxt', 'react', 'vue',
      'mongoose', 'sequelize', 'pg', 'mysql2', 'redis', 'ioredis',
      'lodash', 'axios', 'graphql', 'prisma', '@prisma/client',
      'bull', 'bullmq', 'ws', 'socket.io', 'jsonwebtoken',
      'passport', 'joi', 'zod', 'winston', 'pino',
    ];

    const pkgList = packages
      ? packages.split(',').map(s => s.trim()).filter(Boolean)
      : defaultPkgs;

    // Try package.json first
    const pkgVersions = {};
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const name of pkgList) {
        if (deps[name]) {
          pkgVersions[name] = deps[name];
        }
      }
    } catch (e) {}

    // Also check require.cache for actually loaded versions
    const loadedVersions = {};
    for (const name of pkgList) {
      try {
        const mod = require(name);
        // Try common version patterns
        if (mod.version) {
          loadedVersions[name] = mod.version;
        }
      } catch (e) {}
    }

    // Check node_modules for actual version
    const installedVersions = {};
    for (const name of pkgList) {
      try {
        const modPath = require.resolve.paths(name)
          ? require.resolve.paths(name).map(p => path.join(p, name, 'package.json'))
          : [];
        for (const pp of modPath) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pp, 'utf8'));
            if (pkg.name === name) {
              installedVersions[name] = pkg.version;
              break;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // Merge: prefer installed > pkg.json > loaded
    const result = {};
    const allNames = new Set([
      ...Object.keys(pkgVersions),
      ...Object.keys(loadedVersions),
      ...Object.keys(installedVersions),
    ]);

    for (const name of allNames) {
      result[name] = {
        declared: pkgVersions[name] || null,
        installed: installedVersions[name] || null,
        loaded_version: loadedVersions[name] || null,
        loaded_in_memory: isModuleLoaded(name),
      };
    }

    return {
      package_count: Object.keys(result).length,
      packages: result,
    };
  }
);

/**
 * Check if a module is loaded in require.cache.
 */
function isModuleLoaded(name) {
  for (const id of Object.keys(require.cache)) {
    if (id.includes(`/node_modules/${name}/`)) {
      return true;
    }
  }
  return false;
}
